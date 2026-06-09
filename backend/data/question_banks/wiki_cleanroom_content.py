#!/usr/bin/env python3
"""Clean-room authored wiki prose for Wulo Academy / Pathfinder Learn.

Subjects with no clean, reuse-permitted open textbook (the Nigeria-specific
WAEC/NECO/JSSCE subjects) are authored here from the NERDC scheme-of-work topic
taxonomy, exactly as the existing biology nodes were produced. Each body is
original plain prose written to be read aloud by the assistant: no LaTeX, no
markup, no tables, no images, no symbols the TTS cannot voice.

Consumed by ``scrape_wiki_content.py`` (``build_cleanroom``), which runs every
body through ``clean_text`` and the schema node builder before writing.

Provenance default: source = NERDC scheme-of-work taxonomy, license CC0-1.0
(clean-room original prose). Override per entry with source/license/source_title.

Schema per entry: {year, topic, subtopic, title, body}.
"""
from __future__ import annotations

from typing import Dict, List

CLEANROOM: Dict[str, List[Dict]] = {
    # =====================================================================
    "computer_science": [
        {
            "year": "JSS1", "topic": "introduction to computing",
            "subtopic": "what a computer is", "title": "What a computer is",
            "body": "A computer is an electronic machine that accepts data, processes it following a set of instructions, and gives out useful information. The data you put in is called input, the work the computer does on it is called processing, and the result that comes out is called output. A computer is fast, accurate, and can store very large amounts of information for a long time without getting tired. Because it follows instructions exactly, the quality of its results depends on the quality of the data and instructions it is given. People use computers in schools, banks, hospitals, shops, and offices to calculate, keep records, send messages, and control machines.",
        },
        {
            "year": "JSS1", "topic": "computer system",
            "subtopic": "hardware and software", "title": "Hardware and software",
            "body": "A computer system is made up of two main parts: hardware and software. Hardware refers to the physical parts of the computer that you can touch, such as the monitor, keyboard, mouse, system unit, and printer. Software refers to the sets of instructions, called programs, that tell the hardware what to do. Without software the hardware cannot work, and without hardware the software has nothing to run on. Software is grouped into system software, such as the operating system that manages the whole computer, and application software, such as word processors and games that help people do particular jobs.",
        },
        {
            "year": "JSS2", "topic": "input and output",
            "subtopic": "input and output devices", "title": "Input and output devices",
            "body": "An input device is any part used to enter data and instructions into the computer. Common input devices include the keyboard for typing text and numbers, the mouse for pointing and selecting, the scanner for copying pictures and documents, and the microphone for sound. An output device is any part that gives out the results of processing in a form people can understand. Common output devices include the monitor or screen, which shows results as text and pictures, the printer, which produces results on paper, and the speaker, which gives out sound. Some devices, like a touch screen, can act as both input and output.",
        },
        {
            "year": "JSS3", "topic": "central processing unit",
            "subtopic": "parts of the cpu", "title": "Parts of the central processing unit",
            "body": "The central processing unit, often called the CPU, is the part of the computer that does the actual work of processing data. It is often described as the brain of the computer. The CPU has three main parts. The control unit directs the flow of data and tells the other parts what to do, like a teacher giving instructions. The arithmetic and logic unit carries out calculations such as addition and subtraction and makes comparisons such as deciding which of two numbers is larger. The main memory holds the data and instructions the CPU is working on at that moment. Together these parts make the computer follow a program step by step.",
        },
        {
            "year": "SS1", "topic": "algorithms",
            "subtopic": "algorithms and flowcharts", "title": "Algorithms and flowcharts",
            "body": "An algorithm is a clear, step by step set of instructions for solving a problem or completing a task. A good algorithm is precise, finite, and arranged in the correct order, so that anyone who follows the steps gets the same correct result. For example, the algorithm for boiling water is to fetch water, pour it into a pot, place the pot on heat, and wait until it bubbles. A flowchart is a diagram that shows an algorithm using simple shapes joined by arrows. An oval shows the start and stop, a rectangle shows a process, a parallelogram shows input or output, and a diamond shows a decision. Drawing a flowchart helps a programmer plan a solution before writing actual code.",
        },
        {
            "year": "SS2", "topic": "programming languages",
            "subtopic": "low-level and high-level languages", "title": "Low-level and high-level languages",
            "body": "A programming language is the set of words and rules used to write instructions that a computer can carry out. Languages are grouped into low-level and high-level. A low-level language is close to the way the machine works and is hard for people to read; machine language, written in ones and zeros, and assembly language belong to this group. A high-level language is close to human language and is easier to write and understand; examples include Python, Java, and Basic. Programs written in a high-level language must first be translated into machine language by a translator such as a compiler or an interpreter before the computer can run them.",
        },
        {
            "year": "SS3", "topic": "computer networks",
            "subtopic": "networks and the internet", "title": "Computer networks and the internet",
            "body": "A computer network is a group of two or more computers joined together so they can share data and resources such as printers and an internet connection. A network that covers a small area, such as one office or school, is called a local area network. A network that covers a large area, such as a whole country, is called a wide area network. The internet is the largest network in the world, joining millions of computers across many countries. Through the internet people send electronic mail, browse websites, share files, and hold video calls. Networking saves money and time because users can share one resource instead of buying many.",
        },
    ],
    # =====================================================================
    "data_processing": [
        {
            "year": "JSS1", "topic": "data and information",
            "subtopic": "data and information", "title": "Data and information",
            "body": "Data means raw facts and figures that have not yet been organised or given meaning, such as a list of marks, names, or dates. On its own, data may not tell us much. Information is data that has been processed, arranged, and given meaning so that it becomes useful for making decisions. For example, the scores of all the pupils in a class are data; when you arrange them and work out the class average and the highest score, you produce information. Data processing is the act of turning data into information through steps such as collecting, sorting, calculating, and presenting. Good information should be accurate, complete, and available at the right time.",
        },
        {
            "year": "JSS2", "topic": "word processing",
            "subtopic": "word processing", "title": "Word processing",
            "body": "Word processing is the use of a computer program to create, edit, format, save, and print text documents such as letters, reports, and notes. A word processor lets you type text and then change it easily without rewriting the whole page. You can correct spelling mistakes, move sentences, and add or remove words. Formatting tools let you change the size and style of the letters, make words bold or underlined, and arrange the text in the centre or along the margins. You can also save your work to use again later and print as many copies as you need. Common word processing tasks include preparing assignments, official letters, and class lists.",
        },
        {
            "year": "JSS3", "topic": "spreadsheets",
            "subtopic": "spreadsheet basics", "title": "Spreadsheet basics",
            "body": "A spreadsheet is a program that arranges data in rows and columns so that numbers can be stored, calculated, and analysed easily. The point where a row and a column meet is called a cell, and each cell has an address made from its column letter and row number. You can type numbers, words, or formulas into cells. A formula lets the spreadsheet do calculations automatically, so if you change one number the answers update by themselves. Spreadsheets are useful for keeping accounts, working out totals and averages, and drawing charts. Common spreadsheet programs are used in offices and schools to manage marks, budgets, and stock records.",
        },
        {
            "year": "SS1", "topic": "data processing cycle",
            "subtopic": "the data processing cycle", "title": "The data processing cycle",
            "body": "The data processing cycle is the series of steps by which raw data is turned into useful information. It begins with input, where data is collected and entered into the system. Next comes processing, where the data is sorted, calculated, compared, or summarised according to a set of instructions. Then comes output, where the finished information is presented to the user as a report, screen display, or printout. Storage runs alongside these stages, keeping data and results safely for future use. Because the output of one cycle can become the input of another, the activity is described as a cycle that repeats whenever new data arrives.",
        },
        {
            "year": "SS2", "topic": "database management",
            "subtopic": "database management systems", "title": "Database management systems",
            "body": "A database is an organised collection of related data stored so that it can be found and used easily. A database management system is the software used to create a database and to add, find, change, and remove data within it. Data is usually kept in tables made of records and fields. A field is a single item such as a surname or age, and a record is a complete set of fields about one person or thing. The database management system helps keep data accurate, avoids needless repetition, and controls who may view or change the data. Banks, schools, and hospitals rely on such systems to keep large amounts of records safe and well organised.",
        },
        {
            "year": "SS3", "topic": "data security",
            "subtopic": "data security and integrity", "title": "Data security and integrity",
            "body": "Data security means protecting data from loss, damage, and access by people who are not allowed to use it. Threats to data include theft, fire, computer viruses, and careless mistakes. Several methods are used to keep data safe. Passwords and user accounts make sure only authorised people can open files. Making regular backup copies means data can be recovered if the original is lost. Antivirus programs guard against harmful software. Data integrity means keeping data correct and complete from the time it is entered until it is used, by checking entries for errors and preventing unauthorised changes. Good security and integrity build trust in the information a system produces.",
        },
    ],
    # =====================================================================
    "economics": [
        {
            "year": "SS1", "topic": "basic concepts",
            "subtopic": "scarcity, choice and opportunity cost", "title": "Scarcity, choice and opportunity cost",
            "body": "Economics studies how people use limited resources to satisfy their unlimited wants. Because resources such as money, land, and time are scarce while human wants are endless, no person or country can have everything it desires. This forces everyone to make a choice about which wants to satisfy first. Whenever a choice is made, something else has to be given up. The next best alternative that is given up when a choice is made is called the opportunity cost. For example, if a student spends her last money on a textbook instead of a meal, the meal she gives up is the opportunity cost of the book. Scarcity, choice, and opportunity cost are therefore the foundation of all economic decisions.",
        },
        {
            "year": "SS1", "topic": "factors of production",
            "subtopic": "the factors of production", "title": "The factors of production",
            "body": "The factors of production are the resources used to produce goods and services. There are four of them. Land means all the free gifts of nature used in production, such as soil, rivers, forests, and minerals; its reward is rent. Labour means the human effort, both physical and mental, used in production; its reward is wages or salary. Capital means the man-made goods used to produce other goods, such as tools, machines, and factory buildings; its reward is interest. The entrepreneur is the person who organises the other three factors, takes business risks, and makes decisions; the reward for this is profit. Production can only take place when these factors are brought together.",
        },
        {
            "year": "SS1", "topic": "demand",
            "subtopic": "the law of demand", "title": "The law of demand",
            "body": "Demand is the quantity of a good that buyers are willing and able to buy at a given price within a period of time. For demand to count in economics, the wish to buy must be backed by the money to pay. The law of demand states that, other things being equal, the higher the price of a good the lower the quantity demanded, and the lower the price the higher the quantity demanded. This is why traders often sell more when they reduce their prices. Apart from price, demand is also affected by the income of buyers, the prices of other goods, people's tastes, and the size of the population.",
        },
        {
            "year": "SS2", "topic": "supply",
            "subtopic": "the law of supply", "title": "The law of supply",
            "body": "Supply is the quantity of a good that sellers are willing and able to offer for sale at a given price within a period of time. The law of supply states that, other things being equal, the higher the price of a good the greater the quantity supplied, and the lower the price the smaller the quantity supplied. Producers are willing to bring more goods to the market when prices are high because they expect to earn more profit. Besides price, supply is affected by the cost of production, the state of technology, the number of sellers, government taxes, and natural conditions such as weather, which matters greatly for farm produce.",
        },
        {
            "year": "SS2", "topic": "money",
            "subtopic": "functions of money", "title": "The functions of money",
            "body": "Money is anything that is generally accepted as a means of payment for goods and services and in settlement of debts. Before money, people traded by exchanging goods directly, a system called barter, which was difficult because both traders had to want what the other offered. Money solves this problem and performs several functions. It serves as a medium of exchange, accepted by everyone in buying and selling. It is a measure of value, allowing the worth of different goods to be compared. It is a store of value, since it can be saved and used later. It also acts as a standard for future payments, making it possible to borrow and lend.",
        },
        {
            "year": "SS3", "topic": "national income",
            "subtopic": "national income concepts", "title": "National income",
            "body": "National income is the total money value of all goods and services produced by a country within a given period, usually one year. It measures the size of a nation's economy and shows whether the country is growing richer or poorer over time. A common measure is the gross domestic product, which is the value of everything produced inside the country's borders. When the income earned abroad by the country's citizens is added and the income earned by foreigners at home is removed, we get the gross national product. Dividing national income by the population gives income per head, which gives a rough idea of the average standard of living of the people.",
        },
        {
            "year": "SS3", "topic": "inflation",
            "subtopic": "meaning and effects of inflation", "title": "Inflation",
            "body": "Inflation is a continuous and general rise in the prices of goods and services over a period of time. When inflation is high, the same amount of money buys fewer goods than before, so the value of money falls. Inflation can be caused by too much money chasing too few goods, by a rise in the cost of producing goods, or by people demanding more than the economy can supply. Inflation hurts people on fixed incomes, such as pensioners, because their money buys less. It also discourages saving. Governments try to control inflation by managing the supply of money, encouraging more production, and reducing wasteful spending.",
        },
    ],
    # =====================================================================
    "government": [
        {
            "year": "SS1", "topic": "meaning of government",
            "subtopic": "meaning of government", "title": "The meaning of government",
            "body": "Government can be understood in three main ways. First, it is the group of people and institutions that make and enforce the laws of a state, including the lawmakers, the leaders who carry out the laws, and the courts. Second, it is a process or art of ruling a society, that is, the way power is used to direct the affairs of a country. Third, it is a field of study that examines how states are organised and governed. The main duties of any government are to maintain law and order, protect citizens from internal and external threats, provide social services such as roads and schools, and manage the economy for the good of all.",
        },
        {
            "year": "SS1", "topic": "political concepts",
            "subtopic": "power, authority and sovereignty", "title": "Power, authority and sovereignty",
            "body": "Power is the ability of a person or group to make others do what they want, even against their will. Authority is power that is recognised as rightful and legal, so that people obey it because they accept that the holder has the right to give orders; a police officer directing traffic has authority. Sovereignty is the supreme power of a state to make and enforce laws within its territory without being controlled by any outside body. Internal sovereignty is supreme power over the people and groups inside the country, while external sovereignty means the state is independent and free from the control of other states. These three ideas explain how a state is governed.",
        },
        {
            "year": "SS1", "topic": "constitution",
            "subtopic": "the constitution", "title": "The constitution",
            "body": "A constitution is the body of rules and principles, written or unwritten, by which a state is governed. It sets out how power is shared among the parts of government, how leaders are chosen, and the rights and duties of citizens. A written constitution has its main rules gathered in one document, as in Nigeria and the United States. An unwritten constitution, as in Britain, is drawn from many sources such as laws, court decisions, and long-standing customs. A rigid constitution is hard to change and needs a special procedure, while a flexible constitution can be changed like an ordinary law. The constitution is usually the supreme law, so any other law that conflicts with it is void.",
        },
        {
            "year": "SS2", "topic": "arms of government",
            "subtopic": "the three arms of government", "title": "The three arms of government",
            "body": "Government work is shared among three arms so that no single body holds all power. The legislature is the arm that makes the laws; in Nigeria it is the National Assembly, made up of the Senate and the House of Representatives. The executive is the arm that carries out and enforces the laws; it includes the President or governor, ministers, and the civil service. The judiciary is the arm that interprets the laws and settles disputes through the courts. Sharing duties in this way is meant to prevent the abuse of power and to protect the freedom of citizens, since each arm can check the actions of the others.",
        },
        {
            "year": "SS2", "topic": "separation of powers",
            "subtopic": "separation of powers and checks and balances", "title": "Separation of powers",
            "body": "Separation of powers is the principle that the three arms of government, the legislature, the executive, and the judiciary, should have separate duties and be staffed by different people. The aim is to stop the concentration of power in one hand, which could lead to tyranny. Closely linked to it is the idea of checks and balances, which allows each arm to limit the others. For example, the legislature makes laws but the executive can refuse to sign a bill, and the judiciary can declare a law unconstitutional. The legislature in turn can question the executive and approve appointments. Through these controls, the arms keep one another within their lawful limits.",
        },
        {
            "year": "SS2", "topic": "federalism",
            "subtopic": "federalism", "title": "Federalism",
            "body": "Federalism is a system of government in which power is shared between a central national government and smaller regional or state governments, with each level having duties given to it by the constitution. Neither level is completely under the control of the other in its own area of responsibility. Nigeria practises federalism, with a federal government at the centre and many state governments below it, as well as local governments. Federalism suits large countries with many ethnic groups because it lets different communities manage some of their own affairs while remaining part of one nation. It can, however, lead to disputes between the centre and the states over power and resources.",
        },
        {
            "year": "SS3", "topic": "nigerian government",
            "subtopic": "colonial constitutional development", "title": "Constitutional development in Nigeria",
            "body": "Before independence, Nigeria was governed under a series of constitutions introduced by the British colonial rulers, each named after the governor of the time. The Clifford Constitution of 1922 first allowed a few Nigerians to be elected into a legislative council. The Richards Constitution of 1946 divided the country into regions. The Macpherson Constitution of 1951 widened Nigerian participation and was drawn up after wide consultation. The Lyttleton Constitution of 1954 made Nigeria a federation with greater powers for the regions. These steps gradually increased the role of Nigerians in governing themselves and prepared the way for full independence in 1960. Studying them shows how self-government was achieved in stages.",
        },
    ],
    # =====================================================================
    "history": [
        {
            "year": "SS1", "topic": "meaning of history",
            "subtopic": "meaning and importance of history", "title": "The meaning and importance of history",
            "body": "History is the study of past human events, especially the actions of people and societies, arranged in the order in which they happened. A historian tries to find out what happened, why it happened, and what effects it had. History is important for several reasons. It helps a people understand who they are and where they came from, building a sense of identity and pride. It teaches lessons from past successes and mistakes that can guide present decisions. It records the achievements of earlier generations so they are not forgotten, and it helps explain how the present situation of a society came about. For these reasons every nation values the careful study of its history.",
        },
        {
            "year": "SS1", "topic": "sources of history",
            "subtopic": "sources of history", "title": "Sources of history",
            "body": "Historians rebuild the past using sources, which are the materials that give information about earlier times. There are three main kinds. Oral sources are spoken accounts handed down from one generation to the next, such as stories, songs, and the memories of elders. Written sources are records kept in writing, such as letters, diaries, official documents, newspapers, and books. Archaeological sources are physical remains dug from the ground, such as pottery, tools, bones, coins, and the ruins of buildings. Each kind has strengths and weaknesses, so a careful historian compares several sources to check facts before drawing a conclusion. In societies without writing, oral and archaeological sources are especially valuable.",
        },
        {
            "year": "SS2", "topic": "trans-saharan trade",
            "subtopic": "the trans-saharan trade", "title": "The trans-Saharan trade",
            "body": "The trans-Saharan trade was the exchange of goods carried across the Sahara Desert between North Africa and the kingdoms of West Africa for many centuries. Traders crossed the desert in large groups called caravans, using camels that could travel long distances with little water. From the north came salt, cloth, horses, and manufactured goods, while from the West African south came gold, kola nuts, leather, and enslaved people. The trade made West African empires such as Ghana, Mali, and Songhai wealthy and powerful, and it helped spread the religion of Islam, Arabic learning, and new building styles into the region. The rise of sea trade along the coast later reduced its importance.",
        },
        {
            "year": "SS2", "topic": "old oyo empire",
            "subtopic": "the old oyo empire", "title": "The Old Oyo Empire",
            "body": "The Old Oyo Empire was a powerful Yoruba state that grew in the savanna of present day south western Nigeria and reached its height between the seventeenth and eighteenth centuries. It was ruled by a king called the Alaafin, whose power was balanced by a council of chiefs known as the Oyo Mesi, led by the Bashorun. A secret society called the Ogboni also helped check the king's authority. Oyo built a strong cavalry, using horses bought through trade, which allowed it to control many neighbouring towns and collect tribute from them. The empire grew rich from trade and farming. In the nineteenth century internal disputes and the rise of new powers led to its decline.",
        },
        {
            "year": "SS3", "topic": "colonial rule",
            "subtopic": "indirect rule in nigeria", "title": "Indirect rule in Nigeria",
            "body": "Indirect rule was the system by which the British governed Nigeria through existing traditional rulers rather than only through British officials. Under this system, chiefs and emirs continued to rule their people, collect taxes, and settle disputes, but they did so under the supervision of British officers and according to British wishes. The system was developed by Lord Lugard and worked most smoothly in the north, where the emirs already had a well organised system of administration. It was less successful in parts of the east, where many communities had no single powerful chief, and the appointment of warrant chiefs there caused resentment. Indirect rule allowed Britain to govern a large territory cheaply.",
        },
        {
            "year": "SS3", "topic": "amalgamation",
            "subtopic": "the amalgamation of 1914", "title": "The amalgamation of 1914",
            "body": "The amalgamation of 1914 was the joining together of the Northern and Southern Protectorates of Nigeria into one country under a single colonial government, carried out by Lord Lugard. Before then the two areas had been administered separately. The British united them mainly for administrative convenience and to use the revenue of the wealthier south to support the north. Lugard became the first Governor General of the united Nigeria. Although the amalgamation created the country we know today, the north and south kept many of their separate systems and remained very different in religion, education, and administration. Many historians trace some of Nigeria's later challenges of unity to the way this joining was done.",
        },
    ],
    # =====================================================================
    "literature": [
        {
            "year": "JSS2", "topic": "elements of literature",
            "subtopic": "genres of literature", "title": "The three genres of literature",
            "body": "Literature is the art that uses words to express ideas, feelings, and experiences in a creative way. It is divided into three main genres. Prose is writing in ordinary sentences and paragraphs, the way people normally speak and write; novels and short stories are examples. Drama is writing meant to be acted out on a stage by performers who take the parts of characters; a play is the usual form. Poetry is writing arranged in lines and verses, often using rhythm, sound, and strong imagery to create feeling in few words. Each genre has its own features, but all three use language to entertain, teach, and make readers think more deeply about life.",
        },
        {
            "year": "JSS3", "topic": "figures of speech",
            "subtopic": "common figures of speech", "title": "Common figures of speech",
            "body": "Figures of speech are expressions that use words in a special, non literal way to create a stronger effect. A simile compares two different things using the words like or as, for example, she is as brave as a lion. A metaphor compares two things by saying one is the other, for example, the boy is a lion in the classroom. Personification gives human qualities to things that are not human, as in the wind whispered through the trees. Hyperbole is a deliberate exaggeration used for effect, such as saying I have told you a thousand times. Writers use figures of speech in both prose and poetry to make their language vivid and memorable.",
        },
        {
            "year": "SS1", "topic": "literary devices",
            "subtopic": "imagery and symbolism", "title": "Imagery and symbolism",
            "body": "Imagery is the use of words that appeal to the senses so that readers can picture, hear, or even feel what is being described. When a poet writes about the golden light of the setting sun or the sharp smell of rain on dry earth, the reader experiences the scene more strongly. Symbolism is the use of an object, person, or action to stand for a larger idea beyond itself. For example, a dove may stand for peace, a river may stand for the passage of time, and darkness may stand for fear or ignorance. Both devices allow writers to express deep meaning indirectly, inviting readers to think carefully and find the ideas hidden beneath the surface of the words.",
        },
        {
            "year": "SS2", "topic": "drama",
            "subtopic": "elements of drama", "title": "The elements of drama",
            "body": "Drama is literature written to be performed before an audience. It has several elements. The plot is the arrangement of events from the opening situation, through a rising conflict, to a climax and finally a resolution. Characters are the people in the play, and the way the playwright reveals their nature is called characterisation. Dialogue is the conversation between characters, through which the story is told, since a play has little description. The setting is the time and place of the action. Theme is the central idea or message the play explores. Dramatic devices such as soliloquy, where a character speaks thoughts aloud alone, and dramatic irony, where the audience knows more than a character, deepen the audience's understanding.",
        },
        {
            "year": "SS3", "topic": "poetry",
            "subtopic": "appreciating a poem", "title": "Appreciating a poem",
            "body": "To appreciate a poem means to read it closely and explain how its parts work together to create meaning and feeling. A reader first looks at the subject matter, that is, what the poem is about. Next comes the theme, the deeper idea or message behind the subject. The mood is the feeling the poem creates, such as joy, sorrow, or anger, and the tone is the poet's attitude towards the subject. The reader also studies the form, including the number of lines and verses, and the sound devices such as rhyme and rhythm. Finally, the reader notes the figures of speech and imagery the poet uses. Bringing these observations together produces a full appreciation of the poem.",
        },
    ],
    # =====================================================================
    "agricultural_science": [
        {
            "year": "JSS1", "topic": "introduction to agriculture",
            "subtopic": "meaning and importance of agriculture", "title": "Meaning and importance of agriculture",
            "body": "Agriculture is the cultivation of crops and the rearing of animals for the use of people. It is one of the oldest and most important occupations because it provides the food that everyone needs to live. Besides food, agriculture supplies raw materials for industries, such as cotton for textile factories and hides for leather. It provides work and income for a large part of the population, especially in rural areas. It also earns foreign money for a country when farm produce such as cocoa is sold abroad. Because of these roles in feeding the people, supplying industry, creating jobs, and earning income, agriculture is often called the backbone of many African economies.",
        },
        {
            "year": "JSS1", "topic": "branches of agriculture",
            "subtopic": "branches of agriculture", "title": "Branches of agriculture",
            "body": "Agriculture is a wide subject divided into several branches. Crop production deals with the growing of plants such as maize, yam, and vegetables for food and raw materials. Animal production, also called livestock farming, deals with the rearing of animals such as cattle, goats, poultry, and fish for meat, milk, and eggs. Forestry is the care and management of forests for timber and the protection of the environment. Agricultural economics studies how farm resources are used and how produce is bought and sold. Agricultural engineering deals with farm tools, machines, and structures. Each branch depends on the others, and together they make up the whole field of agriculture.",
        },
        {
            "year": "JSS2", "topic": "farm tools",
            "subtopic": "simple farm tools", "title": "Simple farm tools",
            "body": "Simple farm tools are the hand implements that farmers use to carry out everyday tasks, especially on small farms. The hoe is used for making heaps and ridges, weeding, and turning the soil. The cutlass, or matchet, is used for clearing bushes, cutting, and harvesting. The rake is used for gathering leaves and levelling the soil, while the spade and the shovel are used for digging and lifting soil. The axe is used for cutting down trees and splitting wood. To last long, these tools should be cleaned after use, kept dry to prevent rust, sharpened when blunt, and stored properly in a shed. Well kept tools make farm work easier and faster.",
        },
        {
            "year": "JSS3", "topic": "soil",
            "subtopic": "types of soil", "title": "Types of soil",
            "body": "Soil is the loose top layer of the earth in which plants grow. There are three main types based on the size of their particles. Sandy soil has large particles, feels gritty, drains water quickly, and does not hold nutrients well. Clay soil has very fine particles, feels sticky when wet, holds water and nutrients but drains poorly and can become waterlogged. Loamy soil is a mixture of sand, clay, and silt together with decayed organic matter; it drains well yet holds enough water and nutrients, which makes it the best soil for most crops. A farmer who knows the type of soil on the farm can choose suitable crops and improve the soil where needed.",
        },
        {
            "year": "SS1", "topic": "agricultural ecology",
            "subtopic": "land and its uses", "title": "Land and its uses in agriculture",
            "body": "Land is the natural surface of the earth on which farming takes place, and it is one of the most important resources in agriculture. It provides the space for growing crops and grazing animals, and it holds the soil, water, and minerals that plants need. Land is used in agriculture for crop cultivation, for building structures such as barns and pens, for grazing livestock, and for keeping forests and fish ponds. Because the amount of good farmland is limited and the population keeps growing, land must be used wisely. Practices such as crop rotation, controlling erosion, and avoiding overgrazing help to keep land fertile and productive for future seasons.",
        },
        {
            "year": "SS2", "topic": "animal production",
            "subtopic": "farm animals and their products", "title": "Farm animals and their products",
            "body": "Farm animals, also called livestock, are kept by farmers for the useful products and services they provide. Cattle supply beef, milk, hides for leather, and can be used to pull farm implements. Goats and sheep provide meat, milk, and skins, and they do well in many parts of the country. Poultry, such as fowls and turkeys, supply eggs and meat and grow quickly. Pigs are reared mainly for pork. Fish raised in ponds provide a cheap source of protein. Besides food, animals supply manure that improves soil fertility. To keep livestock healthy and productive, the farmer must provide good feed, clean water, proper housing, and regular care against pests and diseases.",
        },
    ],
    # =====================================================================
    # english — deepen existing partial coverage (currently only 8 nodes)
    "english": [
        {
            "year": "JSS1", "topic": "parts of speech",
            "subtopic": "nouns", "title": "Nouns",
            "body": "A noun is a word that names a person, an animal, a place, a thing, or an idea. Examples are teacher, goat, Lagos, table, and honesty. Nouns are grouped into several kinds. A common noun names any one of a class of things, such as boy or city. A proper noun names a particular person or place and always begins with a capital letter, such as Ada or Kano. A concrete noun names something that can be seen or touched, like a chair, while an abstract noun names an idea or feeling that cannot be touched, like love or fear. A collective noun names a group, such as a team or a flock. Nouns can be singular for one or plural for more than one.",
        },
        {
            "year": "JSS2", "topic": "tenses",
            "subtopic": "the simple tenses", "title": "The simple tenses",
            "body": "Tense shows the time at which the action of a verb takes place. English has three simple tenses. The simple present tense describes an action that happens regularly or a fact that is always true, as in she sings every morning. The simple past tense describes an action that was completed at a time before now, as in she sang yesterday, and most past tense verbs end in the letters e and d. The simple future tense describes an action that will happen later, and it is usually formed with the word will, as in she will sing tomorrow. Using the correct tense helps a listener know exactly when something happened.",
        },
        {
            "year": "JSS3", "topic": "punctuation",
            "subtopic": "using punctuation marks", "title": "Using punctuation marks",
            "body": "Punctuation marks are signs used in writing to make the meaning clear and to show the reader where to pause or stop. The full stop is placed at the end of a complete statement. The comma shows a short pause within a sentence and is used to separate items in a list. The question mark is placed at the end of a sentence that asks something. The exclamation mark shows strong feeling such as surprise or joy. The apostrophe shows that letters have been left out, as in do not becoming don't, or shows ownership, as in the girl's book. Correct punctuation prevents confusion and helps the reader understand the writer's exact meaning.",
        },
        {
            "year": "SS1", "topic": "concord",
            "subtopic": "subject and verb agreement", "title": "Subject and verb agreement",
            "body": "Concord, also called agreement, is the rule that a verb must match its subject in number and person. A singular subject takes a singular verb, and a plural subject takes a plural verb. For example, we say the boy runs fast, but the boys run fast. When two subjects are joined by the word and, they usually take a plural verb, as in Ada and Musa are here. When subjects are joined by or or nor, the verb agrees with the subject nearer to it. Some words such as everybody, each, and nobody are singular and take a singular verb. Mastering concord helps a writer or speaker avoid one of the most common errors in English.",
        },
        {
            "year": "SS2", "topic": "comprehension",
            "subtopic": "reading comprehension skills", "title": "Reading comprehension skills",
            "body": "Reading comprehension is the ability to read a passage and understand its meaning well enough to answer questions on it. To comprehend a passage, a reader should first read it through once to get the general idea, then read it again more slowly to grasp the details. Skimming means reading quickly to find the main point, while scanning means searching for a particular piece of information. A good reader works out the meaning of difficult words from the way they are used in the sentence, a skill called using context. When answering questions, the reader should base every answer on what the passage actually says rather than on personal opinion, and should use his or her own words where asked.",
        },
        {
            "year": "SS3", "topic": "writing skills",
            "subtopic": "formal letter writing", "title": "Formal letter writing",
            "body": "A formal letter is written to someone in an official position, such as a head teacher, a manager, or a government office, and it follows a fixed layout. It begins with the writer's address and the date at the top right, followed by the receiver's title and address on the left. After this comes a greeting such as Dear Sir or Dear Madam. The letter then states its purpose in a clear heading and develops the message in well ordered paragraphs, using polite and serious language. It ends with a closing such as Yours faithfully, followed by the writer's signature and full name. Because the tone is official, slang and short forms are avoided in a formal letter.",
        },
    ],
}
