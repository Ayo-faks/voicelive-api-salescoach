# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See LICENSE in the project root for license information.
# --------------------------------------------------------------------------------------------

"""Analysis components for speech practice and pronunciation assessment."""

import asyncio
import base64
import io
import json
import logging
import re
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

import azure.cognitiveservices.speech as speechsdk  # pyright: ignore[reportMissingTypeStubs]
import yaml
from openai import AzureOpenAI

from src.config import config
from src.services.azure_openai_auth import build_openai_client
from src.services.scenario_utils import determine_scenario_directory

logger = logging.getLogger(__name__)

# Constants
EVALUATION_FILE_SUFFIX = "*evaluation.prompt.yml"
EVALUATION_SUFFIX_REMOVAL = "-evaluation.prompt"
SCENARIO_DATA_DIR = "data/scenarios"
DOCKER_APP_PATH = "/app"

# Scoring constants
MAX_TARGET_SOUND_ACCURACY_SCORE = 10
MAX_OVERALL_CLARITY_SCORE = 10
MAX_CONSISTENCY_SCORE = 10
MAX_TASK_COMPLETION_SCORE = 10
MAX_WILLINGNESS_TO_RETRY_SCORE = 10
MAX_SELF_CORRECTION_ATTEMPTS_SCORE = 10
MAX_OVERALL_SCORE = 100
MAX_ARTICULATION_CLARITY_SCORE = 30
MAX_ENGAGEMENT_AND_EFFORT_SCORE = 30

# Audio processing constants
MIN_AUDIO_SIZE_BYTES = 48000
AUDIO_SAMPLE_RATE = 24000
AUDIO_CHANNELS = 1
AUDIO_SAMPLE_WIDTH = 2
AUDIO_BITS_PER_SAMPLE = 16

# Assessment constants
MAX_CELEBRATION_POINTS_COUNT = 3
MAX_PRACTICE_SUGGESTIONS_COUNT = 3
AGE_ADJUSTED_WORD_ACCURACY_FLOOR = 80
REFERENCE_WORD_PATTERN = re.compile(r"[A-Za-z']+")
AGE_BASED_SUBSTITUTION_RULES = (
    {"target_sound": "r", "max_age": 5, "substitutions": (("r", "w"),)},
    {"target_sound": "l", "max_age": 6, "substitutions": (("l", "w"),)},
    {
        "target_sound": "th",
        "max_age": 6,
        "substitutions": (("th", "f"), ("th", "d"), ("th", "t")),
    },
)

# Fallback evaluation prompt for custom scenarios
FALLBACK_EVALUATION_PROMPT = """You are an expert speech therapy practice reviewer supporting a therapist-supervised session.

Evaluate the child's practice based on:
- Target sound accuracy and overall clarity
- Consistency across repeated attempts
- Engagement, persistence, and willingness to retry
- Positive, constructive next steps for practice

Keep child-visible feedback warm and encouraging. Keep therapist notes concise and clinically useful."""


class ConversationAnalyzer:
    """Analyzes speech practice conversations using Azure OpenAI."""

    def __init__(self, scenario_dir: Optional[Path] = None):
        """
        Initialize the conversation analyzer.

        Args:
            scenario_dir: Directory containing evaluation scenario files
        """
        self.scenario_dir = determine_scenario_directory(scenario_dir)
        self.evaluation_scenarios = self._load_evaluation_scenarios()
        self.openai_client = self._initialize_openai_client()

    def _load_evaluation_scenarios(self) -> Dict[str, Any]:
        """
        Load evaluation scenarios from YAML files.

        Returns:
            Dict[str, Any]: Dictionary of evaluation scenarios keyed by ID
        """
        scenarios: Dict[str, Any] = {}

        if not self.scenario_dir.exists():
            logger.warning("Exercises directory not found: %s", self.scenario_dir)
            return scenarios

        for file in self.scenario_dir.glob(EVALUATION_FILE_SUFFIX):
            try:
                with open(file, encoding="utf-8") as f:
                    scenario = yaml.safe_load(f)
                    scenario_id = file.stem.replace(EVALUATION_SUFFIX_REMOVAL, "")
                    scenarios[scenario_id] = scenario
                    logger.info("Loaded evaluation exercise: %s", scenario_id)
            except Exception as e:
                logger.error("Error loading evaluation exercise %s: %s", file, e)

        logger.info("Total evaluation exercises loaded: %s", len(scenarios))
        return scenarios

    def _initialize_openai_client(self) -> Optional[AzureOpenAI]:
        """
        Initialize the Azure OpenAI client.

        Returns:
            Optional[AzureOpenAI]: Initialized client or None if configuration missing
        """
        try:
            endpoint = config["azure_openai_endpoint"]
            client = build_openai_client(config)
            if client is None:
                return None

            logger.info("ConversationAnalyzer initialized with endpoint: %s", endpoint)
            return client

        except Exception as e:
            logger.error("Failed to initialize OpenAI client: %s", e)
            return None

    async def analyze_conversation(self, scenario_id: str, transcript: str) -> Optional[Dict[str, Any]]:
        """
        Analyze a conversation transcript.

        Args:
            scenario_id: The scenario identifier.
                         For AI generated scenario, use "graph_generated"
            transcript: The conversation transcript to analyze

        Returns:
            Optional[Dict[str, Any]]: Analysis results or None if analysis fails
        """
        logger.info("Starting conversation analysis for exercise: %s", scenario_id)

        evaluation_scenario = self.evaluation_scenarios.get(scenario_id)
        if not evaluation_scenario:
            logger.info("Using fallback evaluation for exercise: %s", scenario_id)
            evaluation_scenario = {"messages": [{"content": FALLBACK_EVALUATION_PROMPT}]}

        if not self.openai_client:
            logger.error("OpenAI client not configured")
            return None

        return await self._call_evaluation_model(evaluation_scenario, transcript)

    def _build_evaluation_prompt(self, scenario: Dict[str, Any], transcript: str) -> str:
        """Build the evaluation prompt."""
        base_prompt = scenario["messages"][0]["content"]
        return f"""{base_prompt}

        EVALUATION CRITERIA:

        **ARTICULATION CLARITY ({MAX_ARTICULATION_CLARITY_SCORE} points total):**
        - target_sound_accuracy: 0-{MAX_TARGET_SOUND_ACCURACY_SCORE} points for accurate production of the target sound(s)
        - overall_clarity: 0-{MAX_OVERALL_CLARITY_SCORE} points for how clear and understandable the child's speech was
        - consistency: 0-{MAX_CONSISTENCY_SCORE} points for maintaining accurate production across repeated attempts

        **ENGAGEMENT AND EFFORT ({MAX_ENGAGEMENT_AND_EFFORT_SCORE} points total):**
        - task_completion: 0-{MAX_TASK_COMPLETION_SCORE} points for staying with the practice task
        - willingness_to_retry: 0-{MAX_WILLINGNESS_TO_RETRY_SCORE} points for trying again after support or modeling
        - self_correction_attempts: 0-{MAX_SELF_CORRECTION_ATTEMPTS_SCORE} points for independently improving or adjusting speech

        Set articulation_clarity.total and engagement_and_effort.total as the sum of their sub-scores.
        Set overall_score on a 0-{MAX_OVERALL_SCORE} scale based on the whole practice session.

        You are evaluating the child speaker only.
        Do not score the assistant or practice buddy.

        Provide up to {MAX_CELEBRATION_POINTS_COUNT} celebration points and up to {MAX_PRACTICE_SUGGESTIONS_COUNT} practice suggestions.
        Celebration points must be positive.
        Practice suggestions must stay constructive and never use negative language.

        CONVERSATION TO EVALUATE:
        {transcript}
        """

    async def _call_evaluation_model(self, scenario: Dict[str, Any], transcript: str) -> Optional[Dict[str, Any]]:
        """
        Call OpenAI with structured outputs for evaluation.

        Args:
            scenario: The evaluation scenario configuration
            transcript: The conversation transcript

        Returns:
            Optional[Dict[str, Any]]: Evaluation results or None if call fails
        """

        if not self.openai_client:
            logger.error("OpenAI client not configured")
            return None
        openai_client = self.openai_client

        try:
            evaluation_prompt = self._build_evaluation_prompt(scenario, transcript)

            completion = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: openai_client.chat.completions.create(
                    model=config["model_deployment_name"],
                    messages=self._build_evaluation_messages(evaluation_prompt),  # pyright: ignore[reportArgumentType]
                    response_format=self._get_response_format(),  # pyright: ignore[reportArgumentType]
                ),
            )

            if completion.choices[0].message.content:
                evaluation_json = json.loads(completion.choices[0].message.content)
                return self._process_evaluation_result(evaluation_json)

            logger.error("No content received from OpenAI")
            return None

        except Exception as e:
            logger.error("Error in evaluation model: %s", e)
            return None

    def _build_evaluation_messages(self, evaluation_prompt: str) -> List[Dict[str, str]]:
        """Build the messages for the evaluation API call."""
        return [
            {
                "role": "system",
                "content": "You are an expert speech therapy practice evaluator. "
                "Analyze the provided conversation and return a structured evaluation.",
            },
            {"role": "user", "content": evaluation_prompt},
        ]

    def _get_response_format(self) -> Dict[str, Any]:
        """Get the structured response format for OpenAI."""
        return {
            "type": "json_schema",
            "json_schema": {
                "name": "speech_therapy_evaluation",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "articulation_clarity": {
                            "type": "object",
                            "properties": {
                                "target_sound_accuracy": {"type": "integer", "minimum": 0, "maximum": 10},
                                "overall_clarity": {"type": "integer", "minimum": 0, "maximum": 10},
                                "consistency": {"type": "integer", "minimum": 0, "maximum": 10},
                                "total": {"type": "integer", "minimum": 0, "maximum": 30},
                            },
                            "required": [
                                "target_sound_accuracy",
                                "overall_clarity",
                                "consistency",
                                "total",
                            ],
                            "additionalProperties": False,
                        },
                        "engagement_and_effort": {
                            "type": "object",
                            "properties": {
                                "task_completion": {"type": "integer", "minimum": 0, "maximum": 10},
                                "willingness_to_retry": {"type": "integer", "minimum": 0, "maximum": 10},
                                "self_correction_attempts": {"type": "integer", "minimum": 0, "maximum": 10},
                                "total": {"type": "integer", "minimum": 0, "maximum": 30},
                            },
                            "required": [
                                "task_completion",
                                "willingness_to_retry",
                                "self_correction_attempts",
                                "total",
                            ],
                            "additionalProperties": False,
                        },
                        "overall_score": {"type": "integer", "minimum": 0, "maximum": 100},
                        "celebration_points": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "practice_suggestions": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "therapist_notes": {"type": "string"},
                    },
                    "required": [
                        "articulation_clarity",
                        "engagement_and_effort",
                        "overall_score",
                        "celebration_points",
                        "practice_suggestions",
                        "therapist_notes",
                    ],
                    "additionalProperties": False,
                },
            },
        }

    def _process_evaluation_result(self, evaluation_json: Dict[str, Any]) -> Dict[str, Any]:
        """Process and validate evaluation results."""
        evaluation_json["articulation_clarity"]["total"] = sum(
            [
                evaluation_json["articulation_clarity"]["target_sound_accuracy"],
                evaluation_json["articulation_clarity"]["overall_clarity"],
                evaluation_json["articulation_clarity"]["consistency"],
            ]
        )

        evaluation_json["engagement_and_effort"]["total"] = sum(
            [
                evaluation_json["engagement_and_effort"]["task_completion"],
                evaluation_json["engagement_and_effort"]["willingness_to_retry"],
                evaluation_json["engagement_and_effort"]["self_correction_attempts"],
            ]
        )

        evaluation_json["overall_score"] = max(
            0,
            min(MAX_OVERALL_SCORE, evaluation_json.get("overall_score", 0)),
        )

        logger.info("Evaluation processed with score: %s", evaluation_json.get("overall_score"))
        return evaluation_json


class PronunciationAssessor:
    """Assesses pronunciation using Azure Speech Services."""

    def __init__(self):
        """Initialize the pronunciation assessor."""
        self.speech_key = config["azure_speech_key"]
        self.speech_region = config["azure_speech_region"]

    def _create_wav_audio(self, audio_bytes: bytearray) -> bytes:
        """Create WAV format audio from raw PCM bytes."""
        with io.BytesIO() as wav_buffer:
            wav_file: wave.Wave_write = wave.open(wav_buffer, "wb")  # type: ignore
            with wav_file:
                wav_file.setnchannels(AUDIO_CHANNELS)
                wav_file.setsampwidth(AUDIO_SAMPLE_WIDTH)
                wav_file.setframerate(AUDIO_SAMPLE_RATE)
                wav_file.writeframes(audio_bytes)

            wav_buffer.seek(0)
            return wav_buffer.read()

    def _log_assessment_info(self, wav_audio: bytes, reference_text: Optional[str]) -> None:
        """Log information about the assessment being performed."""
        logger.info("Starting pronunciation assessment with audio size: %s bytes", len(wav_audio))
        logger.info("Reference text: %s", reference_text or "None")
        logger.info("Speech key configured: %s", "Yes" if self.speech_key else "No")
        logger.info("Speech region: %s", self.speech_region)

    def _get_exercise_metadata_value(self, exercise_metadata: Optional[Dict[str, Any]], *keys: str) -> Any:
        """Return the first present exercise metadata value for the provided keys."""
        if not exercise_metadata:
            return None

        for key in keys:
            value = exercise_metadata.get(key)
            if value is not None:
                return value

        return None

    def _normalize_sound(self, value: Optional[str]) -> str:
        """Normalize a target sound or phoneme label for comparisons."""
        return re.sub(r"[^a-z]", "", (value or "").lower())

    def _extract_reference_words(
        self,
        reference_text: Optional[str],
        exercise_metadata: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        """Extract the ordered reference words used to interpret word-level feedback."""
        target_words = self._get_exercise_metadata_value(exercise_metadata, "targetWords", "target_words")
        if isinstance(target_words, list):
            return [str(word).strip() for word in target_words if str(word).strip()]

        return [match.group(0) for match in REFERENCE_WORD_PATTERN.finditer(reference_text or "")]

    def _get_child_age(self, exercise_metadata: Optional[Dict[str, Any]] = None) -> Optional[int]:
        """Read an optional child age from exercise metadata."""
        child_age = self._get_exercise_metadata_value(exercise_metadata, "childAge", "child_age")

        if child_age is None:
            return None

        if isinstance(child_age, (int, float)):
            return int(child_age)

        if isinstance(child_age, str):
            match = re.search(r"\d+", child_age)
            if match:
                return int(match.group(0))

        return None

    def _is_developmentally_expected_substitution(
        self,
        expected_word: str,
        actual_word: str,
        target_sound: Optional[str],
        child_age: int,
    ) -> bool:
        """Return True when a word-level mispronunciation matches a small explicit age-based rule."""
        normalized_target_sound = self._normalize_sound(target_sound)
        normalized_expected = self._normalize_sound(expected_word)
        normalized_actual = self._normalize_sound(actual_word)

        if not normalized_expected or not normalized_actual:
            return False

        for rule in AGE_BASED_SUBSTITUTION_RULES:
            if child_age > rule["max_age"]:
                continue

            if normalized_target_sound and normalized_target_sound != rule["target_sound"]:
                continue

            for expected_prefix, actual_prefix in rule["substitutions"]:
                if normalized_expected.startswith(expected_prefix) and normalized_actual.startswith(actual_prefix):
                    return True

        return False

    def _apply_age_calibration(
        self,
        assessment_result: Dict[str, Any],
        reference_text: Optional[str],
        exercise_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Suppress a small set of developmentally expected substitutions from child-facing feedback."""
        child_age = self._get_child_age(exercise_metadata)
        words = list(assessment_result.get("words") or [])

        if child_age is None or not words:
            return assessment_result

        target_sound = self._get_exercise_metadata_value(exercise_metadata, "targetSound", "target_sound")
        reference_words = self._extract_reference_words(reference_text, exercise_metadata)
        adjustments_applied = 0
        adjusted_words: List[Dict[str, Any]] = []

        for index, word in enumerate(words):
            adjusted_word = dict(word)
            target_word = reference_words[index] if index < len(reference_words) else adjusted_word.get("word", "")
            adjusted_word["target_word"] = target_word

            if adjusted_word.get("error_type") == "Mispronunciation" and self._is_developmentally_expected_substitution(
                str(target_word),
                str(adjusted_word.get("word", "")),
                cast(Optional[str], target_sound),
                child_age,
            ):
                adjusted_word["age_adjusted"] = True
                adjusted_word["error_type"] = "None"
                adjusted_word["accuracy"] = max(
                    float(adjusted_word.get("accuracy", 0)),
                    float(AGE_ADJUSTED_WORD_ACCURACY_FLOOR),
                )
                adjustments_applied += 1

            adjusted_words.append(adjusted_word)

        if not adjustments_applied:
            return {**assessment_result, "words": adjusted_words}

        adjusted_average = sum(float(word.get("accuracy", 0)) for word in adjusted_words) / len(adjusted_words)

        return {
            **assessment_result,
            "accuracy_score": max(float(assessment_result.get("accuracy_score", 0)), adjusted_average),
            "pronunciation_score": max(
                float(assessment_result.get("pronunciation_score", 0)),
                adjusted_average,
            ),
            "words": adjusted_words,
            "adjustments_applied": adjustments_applied,
        }

    def _create_speech_config(self, exercise_metadata: Optional[Dict[str, Any]] = None) -> speechsdk.SpeechConfig:
        """Create speech configuration."""
        speech_config = speechsdk.SpeechConfig(subscription=self.speech_key, region=self.speech_region)
        speech_language = self._get_exercise_metadata_value(
            exercise_metadata,
            "speechLanguage",
            "speech_language",
        ) or config["azure_speech_language"]
        speech_config.speech_recognition_language = speech_language
        return speech_config

    def _create_pronunciation_config(self, reference_text: Optional[str]) -> speechsdk.PronunciationAssessmentConfig:
        """Create pronunciation assessment configuration."""
        pronunciation_config = speechsdk.PronunciationAssessmentConfig(
            reference_text=reference_text or "",
            grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
            enable_miscue=True,
        )
        pronunciation_config.enable_prosody_assessment()
        return pronunciation_config

    def _create_audio_config(self, wav_audio: bytes) -> speechsdk.audio.AudioConfig:
        """Create audio configuration from WAV data."""
        audio_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=AUDIO_SAMPLE_RATE,
            bits_per_sample=AUDIO_BITS_PER_SAMPLE,
            channels=AUDIO_CHANNELS,
            wave_stream_format=speechsdk.audio.AudioStreamWaveFormat.PCM,
        )

        push_stream = speechsdk.audio.PushAudioInputStream(stream_format=audio_format)
        push_stream.write(wav_audio)
        push_stream.close()

        return speechsdk.audio.AudioConfig(stream=push_stream)

    def _build_assessment_result(
        self,
        pronunciation_result: speechsdk.PronunciationAssessmentResult,
        result: speechsdk.SpeechRecognitionResult,
        reference_text: Optional[str],
        exercise_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Build the final assessment result."""
        raw_result = {
            "accuracy_score": pronunciation_result.accuracy_score,
            "fluency_score": pronunciation_result.fluency_score,
            "completeness_score": pronunciation_result.completeness_score,
            "prosody_score": getattr(pronunciation_result, "prosody_score", None),
            "pronunciation_score": pronunciation_result.pronunciation_score,
            "words": self._extract_word_details(result),
        }

        return self._apply_age_calibration(raw_result, reference_text, exercise_metadata)

    async def assess_pronunciation(
        self,
        audio_data: List[Dict[str, Any]],
        reference_text: Optional[str] = None,
        exercise_metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Assess pronunciation of audio data.

        Args:
            audio_data: List of audio chunks with metadata
            reference_text: Optional reference text for comparison

        Returns:
            Optional[Dict[str, Any]]: Pronunciation assessment results or None if assessment fails
        """
        if not self.speech_key:
            logger.error("Azure Speech key not configured")
            return None

        try:
            combined_audio = await self._prepare_audio_data(audio_data)
            if not combined_audio:
                logger.error("No audio data to assess")
                return None

            logger.info("Combined audio size: %s bytes", len(combined_audio))

            if len(combined_audio) < MIN_AUDIO_SIZE_BYTES:
                logger.warning("Audio might be too short: %s bytes", len(combined_audio))

            wav_audio = self._create_wav_audio(combined_audio)
            return await self._perform_assessment(wav_audio, reference_text, exercise_metadata)

        except Exception as e:
            logger.error("Error in pronunciation assessment: %s", e)
            return None

    async def _prepare_audio_data(self, audio_data: List[Dict[str, Any]]) -> bytearray:
        """Prepare and combine audio chunks."""
        combined_audio = bytearray()

        for chunk in audio_data:
            if chunk.get("type") == "user":
                try:
                    audio_bytes = base64.b64decode(chunk["data"])
                    combined_audio.extend(audio_bytes)
                except Exception as e:
                    logger.error("Error decoding audio chunk: %s", e)

        return combined_audio

    async def _perform_assessment(
        self,
        wav_audio: bytes,
        reference_text: Optional[str],
        exercise_metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Perform the actual pronunciation assessment."""
        self._log_assessment_info(wav_audio, reference_text)

        speech_language = self._get_exercise_metadata_value(
            exercise_metadata,
            "speechLanguage",
            "speech_language",
        ) or config["azure_speech_language"]
        speech_config = self._create_speech_config(exercise_metadata)
        pronunciation_config = self._create_pronunciation_config(reference_text)
        audio_config = self._create_audio_config(wav_audio)

        speech_recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=audio_config,
            language=speech_language,
        )
        pronunciation_config.apply_to(speech_recognizer)

        result = await asyncio.get_event_loop().run_in_executor(None, speech_recognizer.recognize_once)

        pronunciation_result = speechsdk.PronunciationAssessmentResult(result)
        return self._build_assessment_result(
            pronunciation_result,
            result,
            reference_text,
            exercise_metadata,
        )

    def _extract_word_details(self, result: speechsdk.SpeechRecognitionResult) -> List[Dict[str, Any]]:
        """Extract word-level pronunciation details."""
        try:
            json_result = json.loads(
                result.properties.get(
                    speechsdk.PropertyId.SpeechServiceResponse_JsonResult,
                    "{}",
                )  # pyright: ignore[reportUnknownMemberType]  # pyright: ignore[reportUnknownArgumentType]
            )

            words: List[Dict[str, Any]] = []
            if "NBest" in json_result and json_result["NBest"]:
                for word_info in json_result["NBest"][0].get("Words", []):
                    words.append(
                        {
                            "word": word_info.get("Word", ""),
                            "accuracy": word_info.get("PronunciationAssessment", {}).get("AccuracyScore", 0),
                            "error_type": word_info.get("PronunciationAssessment", {}).get("ErrorType", "None"),
                        }
                    )

            return words
        except Exception as e:
            logger.error("Error extracting word details: %s", e)
            return []
