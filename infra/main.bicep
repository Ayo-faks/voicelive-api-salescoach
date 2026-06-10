targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment that can be used as part of naming resource convention')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string


param voicelabExists bool

@description('Id of the user or app to assign application roles')
param principalId string

@description('Principal type of user or app')
param principalType string

param useFoundryAgents bool = false

@description('Microsoft Entra app registration client ID for Easy Auth.')
param microsoftProviderClientId string = ''

@secure()
@description('Microsoft Entra client secret for Easy Auth.')
param microsoftProviderClientSecret string = ''

@description('Google OAuth client ID for Easy Auth.')
param googleProviderClientId string = ''

@secure()
@description('Google OAuth client secret for Easy Auth.')
param googleProviderClientSecret string = ''

@description('Optional override for the Copilot CLI path inside the runtime container.')
param copilotCliPath string = ''

@secure()
@description('Optional GitHub token for Copilot SDK authentication in backend-service scenarios.')
param copilotGithubToken string = ''

@description('Optional model override for the Copilot planner. Defaults to the deployed Azure OpenAI model.')
param copilotPlannerModel string = ''

@description('Optional reasoning effort override for the Copilot planner.')
param copilotPlannerReasoningEffort string = ''

@description('Optional API version override for the Copilot Azure BYOK provider.')
param copilotAzureApiVersion string = ''

@description('Optional Voice Live model override. Defaults to the deployed Azure OpenAI model.')
param voiceLiveModel string = ''

@description('Optional input audio transcription (STT) model override, e.g. mai-transcribe-1. Defaults to azure-speech.')
param inputTranscriptionModel string = ''

@description('Enable Azure Database for PostgreSQL Flexible Server resources and secret wiring.')
param enablePostgresPersistence bool = false

@description('Admin username for Azure Database for PostgreSQL Flexible Server.')
param postgresAdminUsername string = 'wuloadmin'

@secure()
@description('Admin password for Azure Database for PostgreSQL Flexible Server.')
param postgresAdminPassword string = ''

@description('Database name for Azure Database for PostgreSQL Flexible Server.')
param postgresDatabaseName string = 'wulo'

@description('Flexible Server SKU name for Azure Database for PostgreSQL.')
param postgresSkuName string = 'Standard_B1ms'

@description('Database backend the application should use at runtime.')
param databaseBackend string = 'sqlite'

@description('Whether startup migrations should run automatically when DATABASE_BACKEND=postgres.')
param databaseRunMigrationsOnStartup bool = false

@description('Comma-separated AZD environment names allowed to run PostgreSQL startup migrations in Azure-hosted environments.')
param databaseMigrationAllowedEnvironments string = ''

@description('Set PATHFINDER_LEARN_OBSERVABILITY_ENABLED for the backend runtime.')
param pathfinderLearnObservabilityEnabled string = 'true'

@description('Set PATHFINDER_LEARN_PROMETHEUS_ENABLED for the backend runtime.')
param pathfinderLearnPrometheusEnabled string = 'true'

@description('Set PATHFINDER_LEARN_OTEL_ENABLED for the backend runtime.')
param pathfinderLearnOtelEnabled string = 'true'

@description('Set PATHFINDER_VOICELIVE_ENABLED for the backend runtime (Pathfinder VoiceLive realtime path).')
param pathfinderVoiceliveEnabled string = 'true'

@description('Set PATHFINDER_VOICE_ENABLED for the backend runtime (Pathfinder voice features).')
param pathfinderVoiceEnabled string = 'true'

@description('Set PATHFINDER_ASSISTANT_LLM_ENABLED for the backend runtime (model-backed assistant provider).')
param pathfinderAssistantLlmEnabled string = 'true'

@description('Gate 2 (agent-mesh observability cron). DARK BY DEFAULT: when false the scheduled Job is not provisioned at all.')
param enableAgentMeshObservabilityCron bool = false

@description('Cron expression for the agent-mesh observability Job.')
param agentMeshObservabilityCron string = '*/15 * * * *'

@description('Master kill-switch for the agent-mesh observability cron. Empty = dark no-op; set to "1" to arm AGENT_MESH_ENABLED.')
param agentMeshObservabilityEnabled string = ''

@description('Enable optional Ralph LRS container app for Pathfinder Learn xAPI replay.')
param enableRalphLrs bool = false

@description('Container image for Ralph LRS. Leave empty to keep Ralph disabled.')
param ralphLrsImage string = ''

@secure()
@description('Optional Ralph LRS admin token secret.')
param ralphLrsAdminToken string = ''

@description('Optional custom domain bindings for the voicelab Container App ingress.')
param voicelabCustomDomains array = []

@description('Optional ingress IP allow-list (CIDR ranges) for the voicelab Container App. Empty = no restriction. Used to lock the ACA default FQDN to Cloudflare published IP ranges.')
param ingressAllowedSourceRanges array = []

@description('Route application secrets through Azure Key Vault instead of inline Container App secret values. Default false keeps existing environments byte-identical.')
param useKeyVault bool = false

@description('Enable VNet integration + Private Endpoints and disable public network access on data plane resources. Default false keeps existing environments unchanged; must be set on the first provision of a new environment.')
param enablePrivateNetworking bool = false

@description('Enable Microsoft Defender for Cloud plans (Containers, Key Vaults, Open-source relational DBs). NOTE: Defender pricing is SUBSCRIPTION-WIDE — enabling it bills every environment in this subscription, not just this one.')
param enableDefenderPlans bool = false

@description('Enable Azure Communication Services Email resources and backend wiring.')
param enableAzureCommunicationServicesEmail bool = false

@description('Data location for Azure Communication Services Email resources.')
param azureCommunicationServicesDataLocation string = 'Europe'

@description('Email domain resource name. Use AzureManagedDomain for Azure-managed domains, or your verified domain name for customer-managed domains.')
param azureCommunicationServicesDomainName string = 'AzureManagedDomain'

@description('Domain management mode for the Azure Communication Services Email domain.')
param azureCommunicationServicesDomainManagement string = 'AzureManaged'

@description('Link the email domain to the Communication Service. Leave disabled until a customer-managed domain has been verified in DNS.')
param azureCommunicationServicesLinkVerifiedDomain bool = false

@secure()
@description('Optional Azure Communication Services Email connection string for invitation delivery.')
param azureCommunicationServicesConnectionString string = ''

@description('Optional sender address for Azure Communication Services Email invitation delivery.')
param azureCommunicationServicesSenderAddress string = ''

@description('Optional sender display name for Azure Communication Services Email invitation delivery.')
param azureCommunicationServicesSenderDisplayName string = 'Wulo'

@description('Optional public app URL used in invitation emails.')
param publicAppUrl string = ''

@description('Safeguarding: admin email recipient for high+critical events. Leave empty to disable email routing.')
param safeguardingAdminEmail string = ''

@description('Safeguarding: admin SMS recipient (E.164) for critical events. Leave empty to disable SMS routing.')
param safeguardingAdminSmsTo string = ''

@description('Safeguarding: Twilio Account SID for admin SMS. Leave empty to disable SMS.')
@secure()
param twilioAccountSid string = ''

@description('Safeguarding: Twilio Auth Token for admin SMS.')
@secure()
param twilioAuthToken string = ''

@description('Safeguarding: Twilio sender phone number (E.164) for admin SMS.')
param twilioFromNumber string = ''

@description('Safeguarding: Azure AI Content Safety endpoint (L2 detector). Leave empty to skip L2.')
param azureContentSafetyEndpoint string = ''

@description('Safeguarding: Azure AI Content Safety key.')
@secure()
param azureContentSafetyKey string = ''

@description('Safeguarding: when true, suppresses all outbound notifications (in-app only).')
param safeguardingShadowMode bool = false

// Tags that should be applied to all resources.
//
// Note that 'azd-service-name' tags should be applied separately to service host resources.
// Example usage:
//   tags: union(tags, { 'azd-service-name': <service name in azure.yaml> })
var tags = {
  'azd-env-name': environmentName
}

// Organize resources in a resource group
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

// ---------------------------------------------------------------------------
// Microsoft Defender for Cloud (subscription scope). Default-off.
// WARNING: Defender pricing applies to the whole subscription, so enabling this
// for one environment bills every environment in the subscription. Gate behind
// an explicit cost approval before setting ENABLE_DEFENDER_PLANS=true.
// ---------------------------------------------------------------------------
resource defenderContainers 'Microsoft.Security/pricings@2024-01-01' = if (enableDefenderPlans) {
  name: 'Containers'
  properties: {
    pricingTier: 'Standard'
  }
}

resource defenderKeyVaults 'Microsoft.Security/pricings@2024-01-01' = if (enableDefenderPlans) {
  name: 'KeyVaults'
  properties: {
    pricingTier: 'Standard'
  }
}

resource defenderOpenSourceDbs 'Microsoft.Security/pricings@2024-01-01' = if (enableDefenderPlans) {
  name: 'OpenSourceRelationalDatabases'
  properties: {
    pricingTier: 'Standard'
  }
}

module resources 'resources.bicep' = {
  scope: rg
  name: 'resources'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    principalId: principalId
    principalType: principalType
    voicelabExists: voicelabExists
    useFoundryAgents: useFoundryAgents
    microsoftProviderClientId: microsoftProviderClientId
    microsoftProviderClientSecret: microsoftProviderClientSecret
    googleProviderClientId: googleProviderClientId
    googleProviderClientSecret: googleProviderClientSecret
    copilotCliPath: copilotCliPath
    copilotGithubToken: copilotGithubToken
    copilotPlannerModel: copilotPlannerModel
    copilotPlannerReasoningEffort: copilotPlannerReasoningEffort
    copilotAzureApiVersion: copilotAzureApiVersion
    voiceLiveModel: voiceLiveModel
    inputTranscriptionModel: inputTranscriptionModel
    enablePostgresPersistence: enablePostgresPersistence
    postgresAdminUsername: postgresAdminUsername
    postgresAdminPassword: postgresAdminPassword
    postgresDatabaseName: postgresDatabaseName
    postgresSkuName: postgresSkuName
    databaseBackend: databaseBackend
    databaseRunMigrationsOnStartup: databaseRunMigrationsOnStartup
    databaseMigrationAllowedEnvironments: databaseMigrationAllowedEnvironments
    pathfinderLearnObservabilityEnabled: pathfinderLearnObservabilityEnabled
    pathfinderLearnPrometheusEnabled: pathfinderLearnPrometheusEnabled
    pathfinderLearnOtelEnabled: pathfinderLearnOtelEnabled
    pathfinderVoiceliveEnabled: pathfinderVoiceliveEnabled
    pathfinderVoiceEnabled: pathfinderVoiceEnabled
    pathfinderAssistantLlmEnabled: pathfinderAssistantLlmEnabled
    enableAgentMeshObservabilityCron: enableAgentMeshObservabilityCron
    agentMeshObservabilityCron: agentMeshObservabilityCron
    agentMeshObservabilityEnabled: agentMeshObservabilityEnabled
    enableRalphLrs: enableRalphLrs
    ralphLrsImage: ralphLrsImage
    ralphLrsAdminToken: ralphLrsAdminToken
    voicelabCustomDomains: voicelabCustomDomains
    ingressAllowedSourceRanges: ingressAllowedSourceRanges
    useKeyVault: useKeyVault
    enablePrivateNetworking: enablePrivateNetworking
    enableAzureCommunicationServicesEmail: enableAzureCommunicationServicesEmail
    azureCommunicationServicesDataLocation: azureCommunicationServicesDataLocation
    azureCommunicationServicesDomainName: azureCommunicationServicesDomainName
    azureCommunicationServicesDomainManagement: azureCommunicationServicesDomainManagement
    azureCommunicationServicesLinkVerifiedDomain: azureCommunicationServicesLinkVerifiedDomain
    azureCommunicationServicesConnectionString: azureCommunicationServicesConnectionString
    azureCommunicationServicesSenderAddress: azureCommunicationServicesSenderAddress
    azureCommunicationServicesSenderDisplayName: azureCommunicationServicesSenderDisplayName
    publicAppUrl: publicAppUrl
    safeguardingAdminEmail: safeguardingAdminEmail
    safeguardingAdminSmsTo: safeguardingAdminSmsTo
    twilioAccountSid: twilioAccountSid
    twilioAuthToken: twilioAuthToken
    twilioFromNumber: twilioFromNumber
    azureContentSafetyEndpoint: azureContentSafetyEndpoint
    azureContentSafetyKey: azureContentSafetyKey
    safeguardingShadowMode: safeguardingShadowMode
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output AZURE_RESOURCE_VOICELAB_ID string = resources.outputs.AZURE_RESOURCE_VOICELAB_ID
output AZURE_CONTAINER_APP_ENVIRONMENT_NAME string = resources.outputs.AZURE_CONTAINER_APP_ENVIRONMENT_NAME
output AZURE_CONTAINER_APP_NAME string = resources.outputs.AZURE_CONTAINER_APP_NAME
output SERVICE_VOICELAB_URI string = resources.outputs.SERVICE_VOICELAB_URI
output PROJECT_ENDPOINT string = resources.outputs.PROJECT_ENDPOINT
output AZURE_OPENAI_ENDPOINT string = resources.outputs.AZURE_OPENAI_ENDPOINT
output AZURE_SPEECH_REGION string = resources.outputs.AZURE_SPEECH_REGION
output AI_FOUNDRY_RESOURCE_NAME string = resources.outputs.AI_FOUNDRY_RESOURCE_NAME
output POSTGRES_SERVER_FQDN string = resources.outputs.POSTGRES_SERVER_FQDN
output POSTGRES_DATABASE_NAME string = resources.outputs.POSTGRES_DATABASE_NAME
output AZURE_COMMUNICATION_SERVICE_NAME string = resources.outputs.AZURE_COMMUNICATION_SERVICE_NAME
output AZURE_EMAIL_COMMUNICATION_SERVICE_NAME string = resources.outputs.AZURE_EMAIL_COMMUNICATION_SERVICE_NAME
output RALPH_LRS_URI string = resources.outputs.RALPH_LRS_URI
