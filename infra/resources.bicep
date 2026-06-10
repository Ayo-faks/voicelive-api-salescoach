@description('The location used for all deployed resources')
param location string = resourceGroup().location

@description('Tags that will be applied to all resources')
param tags object = {}

@description('Name of the azd environment to drive environment-specific auth redirect configuration')
param environmentName string

param voicelabExists bool

param useFoundryAgents bool

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

@description('Least-privilege runtime username for the application PostgreSQL connection.')
param postgresAppUsername string = 'wuloapp'

@secure()
@description('Least-privilege runtime password for the application PostgreSQL connection. If empty, runtime falls back to the admin connection string.')
param postgresAppPassword string = ''

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

@description('Azure OpenAI deployment used ONLY by the Pathfinder text tutor (PATHFINDER_ASSISTANT_MODEL_DEPLOYMENT). Empty = fall back to MODEL_DEPLOYMENT_NAME. gpt-5.4-mini cuts tutor turn latency ~3x vs gpt-4o.')
param pathfinderAssistantModelDeployment string = 'gpt-5.4-mini'

@description('Enable optional Ralph LRS container app for Pathfinder Learn xAPI replay.')
param enableRalphLrs bool = false

@description('Container image for Ralph LRS. Leave empty to keep Ralph disabled.')
param ralphLrsImage string = ''

@secure()
@description('Optional Ralph LRS admin token secret.')
param ralphLrsAdminToken string = ''

@description('Optional custom domain bindings for the voicelab Container App ingress.')
param voicelabCustomDomains array = []

@description('Optional ingress IP allow-list (CIDR ranges) for the voicelab Container App. Empty = no restriction (current behavior). When set, only listed ranges may reach the origin; used to lock the ACA default FQDN to Cloudflare published IP ranges.')
param ingressAllowedSourceRanges array = []

@description('Route application secrets through Azure Key Vault instead of inline Container App secret values. Default false keeps existing environments byte-identical; new environments (e.g. academy) set this true.')
param useKeyVault bool = false

@description('Enable VNet integration + Private Endpoints and disable public network access on data plane resources (Postgres, AI Foundry, Key Vault, Storage). Default false keeps existing environments unchanged. Cannot be retrofitted onto an existing Container Apps environment, so it must be set on the first provision of a new environment.')
param enablePrivateNetworking bool = false

@description('Enable Azure Communication Services Email resources and backend wiring.')
param enableAzureCommunicationServicesEmail bool = false

@description('Data location for Azure Communication Services Email resources.')
param azureCommunicationServicesDataLocation string = 'Europe'

@description('Email domain resource name. Use AzureManagedDomain for Azure-managed domains, or your verified domain name for customer-managed domains.')
param azureCommunicationServicesDomainName string = 'AzureManagedDomain'

@description('Domain management mode for the Azure Communication Services Email domain.')
@allowed([
  'AzureManaged'
  'CustomerManaged'
  'CustomerManagedInExchangeOnline'
])
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

@description('Safeguarding: admin email recipient for high+critical events.')
param safeguardingAdminEmail string = ''

@description('Safeguarding: admin SMS recipient (E.164) for critical events.')
param safeguardingAdminSmsTo string = ''

@description('Safeguarding: Twilio Account SID for admin SMS.')
@secure()
param twilioAccountSid string = ''

@description('Safeguarding: Twilio Auth Token for admin SMS.')
@secure()
param twilioAuthToken string = ''

@description('Safeguarding: Twilio sender phone number (E.164) for admin SMS.')
param twilioFromNumber string = ''

@description('Safeguarding: Azure AI Content Safety endpoint (L2 detector).')
param azureContentSafetyEndpoint string = ''

@description('Safeguarding: Azure AI Content Safety key.')
@secure()
param azureContentSafetyKey string = ''

@description('Safeguarding: when true, suppresses all outbound notifications (in-app only).')
param safeguardingShadowMode bool = false

@description('VAPID public key for Pathfinder W8 Web Push spaced-retrieval reminders. Leave empty to skip provisioning the notifications dispatcher job.')
@secure()
param vapidPublicKey string = ''

@description('VAPID private key (X.509-EC) for Pathfinder W8 Web Push spaced-retrieval reminders.')
@secure()
param vapidPrivateKey string = ''

@description('VAPID subject (mailto: address) advertised in JWT claims to the push service.')
param vapidSubject string = 'mailto:notify@wulo.ai'

@description('Cron expression for the notifications dispatcher Container Apps Job. Default: every 5 minutes.')
param notificationsDispatcherCron string = '*/5 * * * *'

@description('Gate 2 (agent-mesh observability cron). DARK BY DEFAULT: when false the scheduled Job is not provisioned at all. Provisioning it is an explicit human go-live stop-point; even once provisioned the cron stays a no-op until AGENT_MESH_ENABLED is set in agentMeshObservabilityEnabled.')
param enableAgentMeshObservabilityCron bool = false

@description('Cron expression for the agent-mesh observability Job. Default: every 15 minutes (cheap, read-only).')
param agentMeshObservabilityCron string = '*/15 * * * *'

@description('Second, independent dark gate for the agent-mesh observability cron. Empty keeps the cron a no-op even when the Job is provisioned. Set to "1" ONLY behind the gate-2 sign-off to arm the read-only mesh.')
param agentMeshObservabilityEnabled string = ''

@description('Public application URL used in invitation emails. Defaults to the active custom domain or Container App host.')
param publicAppUrl string = ''

@description('Id of the user or app to assign application roles')
param principalId string

@description('Principal type of user or app')
param principalType string

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = uniqueString(subscription().id, resourceGroup().id, location)
var defaultVoicelabHost = 'https://voicelab.${containerAppsEnvironment.outputs.defaultDomain}'
var postgresServerName = 'psql-voicelab-${take(resourceToken, 18)}'
var communicationServiceName = 'acs-voicelab-${take(resourceToken, 18)}'
var emailServiceName = 'acsemail-voicelab-${take(resourceToken, 18)}'
var resolvedAcsSenderUsername = !empty(azureCommunicationServicesSenderAddress) && contains(azureCommunicationServicesSenderAddress, '@')
  ? split(azureCommunicationServicesSenderAddress, '@')[0]
  : ''
var customRedirectHost = environmentName == 'salescoach-swe'
  ? 'https://staging-sen.wulo.ai'
  : environmentName == 'salescoach-prod'
    ? 'https://sen.wulo.ai'
    : ''
// Env-driven public host for Easy Auth external redirects. Prefer the explicit
// publicAppUrl param (PUBLIC_APP_URL) so new environments (e.g. academy) do not
// require a hardcoded environmentName branch; fall back to the legacy per-env
// host for backward compatibility with salescoach-swe / salescoach-prod.
var resolvedRedirectHost = !empty(publicAppUrl) ? publicAppUrl : customRedirectHost
var resolvedPublicAppUrl = !empty(publicAppUrl)
  ? publicAppUrl
  : !empty(customRedirectHost)
    ? customRedirectHost
    : defaultVoicelabHost
var resolvedAcsConnectionString = enableAzureCommunicationServicesEmail
  ? communicationService!.listKeys().primaryConnectionString
  : azureCommunicationServicesConnectionString
var easyAuthEnabled = !empty(microsoftProviderClientId) || !empty(googleProviderClientId)
var usePostgresRuntimeCredential = !empty(postgresAppUsername) && !empty(postgresAppPassword)
var postgresRuntimeUsername = usePostgresRuntimeCredential ? postgresAppUsername : postgresAdminUsername
var postgresRuntimePassword = usePostgresRuntimeCredential ? postgresAppPassword : postgresAdminPassword
var postgresRuntimeConnectionString = enablePostgresPersistence ? 'postgresql://${postgresRuntimeUsername}:${postgresRuntimePassword}@${postgresServer!.properties.fullyQualifiedDomainName}:5432/${postgresDatabaseName}?sslmode=require' : ''
var postgresAdminConnectionString = enablePostgresPersistence ? 'postgresql://${postgresAdminUsername}:${postgresAdminPassword}@${postgresServer!.properties.fullyQualifiedDomainName}:5432/${postgresDatabaseName}?sslmode=require' : ''

// Application secrets, computed once and shared between the inline Container App
// secret list (default) and the Key Vault-backed variant (useKeyVault=true).
// Keeping a single source of truth guarantees the two code paths stay in sync.
var voicelabInlineSecrets = concat(
  [
    {
      name: 'speech-api-key'
      value: speechService.listKeys().key1
    }
  ],
  enablePostgresPersistence
    ? [
        {
          name: 'postgres-database-url'
          value: postgresRuntimeConnectionString
        }
        {
          name: 'postgres-admin-database-url'
          value: postgresAdminConnectionString
        }
      ]
    : [],
  !empty(copilotGithubToken)
    ? [
        {
          name: 'copilot-github-token'
          value: copilotGithubToken
        }
      ]
    : [],
  !empty(microsoftProviderClientSecret)
    ? [
        {
          name: 'microsoft-provider-auth-secret'
          value: microsoftProviderClientSecret
        }
      ]
    : [],
  !empty(googleProviderClientSecret)
    ? [
        {
          name: 'google-provider-auth-secret'
          value: googleProviderClientSecret
        }
      ]
    : [],
  !empty(azureCommunicationServicesConnectionString) || enableAzureCommunicationServicesEmail
    ? [
        {
          name: 'azure-communication-services-connection-string'
          value: resolvedAcsConnectionString
        }
      ]
    : [],
  !empty(twilioAuthToken)
    ? [
        {
          name: 'twilio-auth-token'
          value: twilioAuthToken
        }
        {
          name: 'twilio-account-sid'
          value: twilioAccountSid
        }
      ]
    : [],
  !empty(azureContentSafetyKey)
    ? [
        {
          name: 'azure-content-safety-key'
          value: azureContentSafetyKey
        }
      ]
    : []
)
// Key Vault-backed equivalents: same secret names, but the Container App resolves
// them from Key Vault using the user-assigned managed identity (Key Vault Secrets
// User). vaultUri already ends with '/', so no version suffix = always latest.
// Built as a conditional concat (not a for-loop) because the inline values use
// listKeys()/connection strings, which Bicep cannot evaluate at the start of a
// loop expression. Only consumed when useKeyVault=true.
var voicelabKeyVaultSecrets = concat(
  [
    {
      name: 'speech-api-key'
      keyVaultUrl: '${keyVaultVaultUri}secrets/speech-api-key'
      identity: voicelabIdentity.outputs.resourceId
    }
  ],
  enablePostgresPersistence
    ? [
        {
          name: 'postgres-database-url'
          keyVaultUrl: '${keyVaultVaultUri}secrets/postgres-database-url'
          identity: voicelabIdentity.outputs.resourceId
        }
        {
          name: 'postgres-admin-database-url'
          keyVaultUrl: '${keyVaultVaultUri}secrets/postgres-admin-database-url'
          identity: voicelabIdentity.outputs.resourceId
        }
      ]
    : [],
  !empty(copilotGithubToken)
    ? [
        {
          name: 'copilot-github-token'
          keyVaultUrl: '${keyVaultVaultUri}secrets/copilot-github-token'
          identity: voicelabIdentity.outputs.resourceId
        }
      ]
    : [],
  !empty(microsoftProviderClientSecret)
    ? [
        {
          name: 'microsoft-provider-auth-secret'
          keyVaultUrl: '${keyVaultVaultUri}secrets/microsoft-provider-auth-secret'
          identity: voicelabIdentity.outputs.resourceId
        }
      ]
    : [],
  !empty(googleProviderClientSecret)
    ? [
        {
          name: 'google-provider-auth-secret'
          keyVaultUrl: '${keyVaultVaultUri}secrets/google-provider-auth-secret'
          identity: voicelabIdentity.outputs.resourceId
        }
      ]
    : [],
  !empty(azureCommunicationServicesConnectionString) || enableAzureCommunicationServicesEmail
    ? [
        {
          name: 'azure-communication-services-connection-string'
          keyVaultUrl: '${keyVaultVaultUri}secrets/azure-communication-services-connection-string'
          identity: voicelabIdentity.outputs.resourceId
        }
      ]
    : [],
  !empty(twilioAuthToken)
    ? [
        {
          name: 'twilio-auth-token'
          keyVaultUrl: '${keyVaultVaultUri}secrets/twilio-auth-token'
          identity: voicelabIdentity.outputs.resourceId
        }
        {
          name: 'twilio-account-sid'
          keyVaultUrl: '${keyVaultVaultUri}secrets/twilio-account-sid'
          identity: voicelabIdentity.outputs.resourceId
        }
      ]
    : [],
  !empty(azureContentSafetyKey)
    ? [
        {
          name: 'azure-content-safety-key'
          keyVaultUrl: '${keyVaultVaultUri}secrets/azure-content-safety-key'
          identity: voicelabIdentity.outputs.resourceId
        }
      ]
    : []
)

param gptModelName string = 'gpt-4o'
param gptModelVersion string = '2024-11-20'
param gptDeploymentName string = 'gpt-4o'

param openAiModelDeployments array = [
  {
    name: gptDeploymentName
    model: gptModelName
    version: gptModelVersion
    sku: {
      name: 'Standard'
      capacity: 10
    }
  }
  {
    name: 'gpt-5.4-mini'
    model: 'gpt-5.4-mini'
    version: '2026-03-17'
    sku: {
      name: 'GlobalStandard'
      capacity: 50
    }
  }
  {
    name: 'text-embedding-ada-002'
    model: 'text-embedding-ada-002'
    sku: {
      name: 'Standard'
      capacity: 10
    }
  }
  {
    name: 'text-embedding-3-small'
    model: 'text-embedding-3-small'
    version: '1'
    sku: {
      name: 'GlobalStandard'
      capacity: 50
    }
  }
]

resource aiFoundryResource 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'aifoundry-voicelab-${resourceToken}'
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: 'aifoundry-voicelab-${resourceToken}'
    publicNetworkAccess: enablePrivateNetworking ? 'Disabled' : 'Enabled'
  }

  @batchSize(1)
  resource deployment 'deployments' = [
    for deployment in openAiModelDeployments: {
      name: deployment.name
      sku: deployment.?sku ?? {
        name: 'Standard'
        capacity: 20
      }
      properties: {
        model: {
          format: 'OpenAI'
          name: deployment.model
          version: deployment.?version ?? null
        }
        raiPolicyName: deployment.?raiPolicyName ?? null
        versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
      }
    }
  ]
}

resource speechService 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'speech-voicelab-${resourceToken}'
  location: location
  tags: tags
  kind: 'SpeechServices'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: 'speech-voicelab-${resourceToken}'
    publicNetworkAccess: enablePrivateNetworking ? 'Disabled' : 'Enabled'
  }
}

resource emailService 'Microsoft.Communication/emailServices@2026-03-18' = if (enableAzureCommunicationServicesEmail) {
  name: emailServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: azureCommunicationServicesDataLocation
  }
}

resource emailDomain 'Microsoft.Communication/emailServices/domains@2026-03-18' = if (enableAzureCommunicationServicesEmail) {
  parent: emailService
  name: azureCommunicationServicesDomainName
  location: 'global'
  tags: tags
  properties: {
    domainManagement: azureCommunicationServicesDomainManagement
    userEngagementTracking: 'Disabled'
  }
}

resource emailSenderUsername 'Microsoft.Communication/emailServices/domains/senderUsernames@2026-03-18' = if (enableAzureCommunicationServicesEmail && azureCommunicationServicesDomainManagement == 'CustomerManaged' && !empty(resolvedAcsSenderUsername) && toLower(resolvedAcsSenderUsername) != 'donotreply') {
  parent: emailDomain
  name: resolvedAcsSenderUsername
  properties: {
    username: resolvedAcsSenderUsername
    displayName: azureCommunicationServicesSenderDisplayName
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2026-03-18' = if (enableAzureCommunicationServicesEmail) {
  name: communicationServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: azureCommunicationServicesDataLocation
    publicNetworkAccess: 'Enabled'
    linkedDomains: azureCommunicationServicesLinkVerifiedDomain ? [
      emailDomain.id
    ] : []
  }
}

resource persistenceStorage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: '${abbrs.storageStorageAccounts}${resourceToken}data'
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: union(
    {
      minimumTlsVersion: 'TLS1_2'
      supportsHttpsTrafficOnly: true
    },
    enablePrivateNetworking
      ? {
          publicNetworkAccess: 'Disabled'
          networkAcls: {
            bypass: 'AzureServices'
            defaultAction: 'Deny'
          }
        }
      : {}
  )
}

resource persistenceFileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  name: '${persistenceStorage.name}/default/wulo-data'
  properties: {
    shareQuota: 1
  }
}

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: persistenceStorage
  name: 'default'
}

resource backupBlobContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobServices
  name: 'wulo-backup'
  properties: {
    publicAccess: 'None'
  }
}

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = if (enablePostgresPersistence) {
  name: postgresServerName
  location: location
  tags: tags
  sku: {
    name: postgresSkuName
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: postgresAdminUsername
    administratorLoginPassword: postgresAdminPassword
    version: '16'
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    network: {
      publicNetworkAccess: enablePrivateNetworking ? 'Disabled' : 'Enabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = if (enablePostgresPersistence) {
  parent: postgresServer
  name: postgresDatabaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresAllowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = if (enablePostgresPersistence && !enablePrivateNetworking) {
  parent: postgresServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource containerAppsManagedEnvironment 'Microsoft.App/managedEnvironments@2025-10-02-preview' existing = {
  name: '${abbrs.appManagedEnvironments}${resourceToken}'
}

resource voicelabContainerApp 'Microsoft.App/containerApps@2024-03-01' existing = {
  name: 'voicelab'
}

// Monitor application with Azure Monitor
module monitoring 'br/public:avm/ptn/azd/monitoring:0.1.0' = {
  name: 'monitoring'
  params: {
    logAnalyticsName: '${abbrs.operationalInsightsWorkspaces}${resourceToken}'
    applicationInsightsName: '${abbrs.insightsComponents}${resourceToken}'
    applicationInsightsDashboardName: '${abbrs.portalDashboards}${resourceToken}'
    location: location
    tags: tags
  }
}
// Azure Monitor alert rules (push notifications for the observability surface)
module monitoringAlerts 'monitoring-alerts.bicep' = {
  name: 'monitoring-alerts'
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    alertEmail: safeguardingAdminEmail
    applicationInsightsResourceId: monitoring.outputs.applicationInsightsResourceId
  }
}
// Container registry
module containerRegistry 'br/public:avm/res/container-registry/registry:0.1.1' = {
  name: 'registry'
  params: {
    name: '${abbrs.containerRegistryRegistries}${resourceToken}'
    location: location
    tags: tags
    publicNetworkAccess: 'Enabled'
    roleAssignments: [
      {
        principalId: voicelabIdentity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: subscriptionResourceId(
          'Microsoft.Authorization/roleDefinitions',
          '7f951dda-4ed3-4680-a7ca-43fe172d538d'
        )
      }
    ]
  }
}

// Optional private networking: VNet for Container Apps egress + private endpoints.
// Default-off; cannot be retrofitted onto an existing Container Apps environment.
module network 'network.bicep' = if (enablePrivateNetworking) {
  name: 'network'
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
  }
}

// Container apps environment
module containerAppsEnvironment 'br/public:avm/res/app/managed-environment:0.4.5' = {
  name: 'container-apps-environment'
  params: {
    logAnalyticsWorkspaceResourceId: monitoring.outputs.logAnalyticsWorkspaceResourceId
    name: '${abbrs.appManagedEnvironments}${resourceToken}'
    location: location
    zoneRedundant: false
    infrastructureSubnetId: enablePrivateNetworking ? network!.outputs.infraSubnetResourceId : ''
  }
}

resource containerAppsManagedEnvironmentStorage 'Microsoft.App/managedEnvironments/storages@2025-10-02-preview' = {
  parent: containerAppsManagedEnvironment
  name: 'wulo-data'
  properties: {
    azureFile: {
      accessMode: 'ReadWrite'
      accountName: persistenceStorage.name
      accountKey: persistenceStorage.listKeys().keys[0].value
      shareName: 'wulo-data'
    }
  }
  dependsOn: [
    containerAppsEnvironment
  ]
}

module voicelabIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.2.1' = {
  name: 'voicelabidentity'
  params: {
    name: '${abbrs.managedIdentityUserAssignedIdentities}voicelab-${resourceToken}'
    location: location
  }
}

// ---------------------------------------------------------------------------
// Key Vault (gated on useKeyVault). RBAC-authorized; the user-assigned identity
// gets Key Vault Secrets User and the Container App reads secrets at runtime.
// Default-off so existing environments render identically.
// ---------------------------------------------------------------------------
var keyVaultName = 'kv-vl-${resourceToken}'
// Built-in role: Key Vault Secrets User
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
// vaultUri (ends with '/') used to build Container App keyVaultUrl references.
// Only meaningful when useKeyVault=true; '' otherwise so the inline path is unaffected.
var keyVaultVaultUri = useKeyVault ? keyVault!.properties.vaultUri : ''

// Static secret name list drives the Key Vault secret resource loop. The list is
// known at the start of deployment (no runtime values), which the loop requires;
// per-secret enablement and values are looked up from the maps below.
var keyVaultSecretNames = [
  'speech-api-key'
  'postgres-database-url'
  'postgres-admin-database-url'
  'copilot-github-token'
  'microsoft-provider-auth-secret'
  'google-provider-auth-secret'
  'azure-communication-services-connection-string'
  'twilio-auth-token'
  'twilio-account-sid'
  'azure-content-safety-key'
]
var keyVaultSecretEnabled = {
  'speech-api-key': true
  'postgres-database-url': enablePostgresPersistence
  'postgres-admin-database-url': enablePostgresPersistence
  'copilot-github-token': !empty(copilotGithubToken)
  'microsoft-provider-auth-secret': !empty(microsoftProviderClientSecret)
  'google-provider-auth-secret': !empty(googleProviderClientSecret)
  'azure-communication-services-connection-string': !empty(azureCommunicationServicesConnectionString) || enableAzureCommunicationServicesEmail
  'twilio-auth-token': !empty(twilioAuthToken)
  'twilio-account-sid': !empty(twilioAuthToken)
  'azure-content-safety-key': !empty(azureContentSafetyKey)
}
var keyVaultSecretValues = {
  'speech-api-key': speechService.listKeys().key1
  'postgres-database-url': postgresRuntimeConnectionString
  'postgres-admin-database-url': postgresAdminConnectionString
  'copilot-github-token': copilotGithubToken
  'microsoft-provider-auth-secret': microsoftProviderClientSecret
  'google-provider-auth-secret': googleProviderClientSecret
  'azure-communication-services-connection-string': resolvedAcsConnectionString
  'twilio-auth-token': twilioAuthToken
  'twilio-account-sid': twilioAccountSid
  'azure-content-safety-key': azureContentSafetyKey
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = if (useKeyVault) {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: enablePrivateNetworking ? 'Disabled' : 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: enablePrivateNetworking ? 'Deny' : 'Allow'
    }
  }
}

resource keyVaultSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [
  for secretName in keyVaultSecretNames: if (useKeyVault && keyVaultSecretEnabled[secretName]) {
    parent: keyVault
    name: secretName
    properties: {
      value: keyVaultSecretValues[secretName]
    }
  }
]

resource keyVaultSecretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (useKeyVault) {
  scope: keyVault
  name: guid(resourceGroup().id, 'voicelab-kv-secrets-user', keyVaultSecretsUserRoleId)
  properties: {
    principalId: voicelabIdentity.outputs.principalId
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      keyVaultSecretsUserRoleId
    )
    principalType: 'ServicePrincipal'
  }
}

// Private endpoints for data-plane resources (gated on enablePrivateNetworking).
// Provisioned after the data stores and Key Vault so their resource IDs are known.
module privateEndpoints 'private-endpoints.bicep' = if (enablePrivateNetworking) {
  name: 'private-endpoints'
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    vnetResourceId: enablePrivateNetworking ? network!.outputs.vnetResourceId : ''
    privateEndpointSubnetResourceId: enablePrivateNetworking ? network!.outputs.privateEndpointSubnetResourceId : ''
    aiFoundryResourceId: aiFoundryResource.id
    speechResourceId: speechService.id
    storageResourceId: persistenceStorage.id
    enablePostgres: enablePostgresPersistence
    postgresResourceId: enablePostgresPersistence ? postgresServer!.id : ''
    enableKeyVault: useKeyVault
    keyVaultResourceId: useKeyVault ? keyVault!.id : ''
  }
}

module voicelabFetchLatestImage './modules/fetch-container-image.bicep' = {
  name: 'voicelab-fetch-image'
  params: {
    exists: voicelabExists
    name: 'voicelab'
  }
}

module voicelab 'br/public:avm/res/app/container-app:0.8.0' = {
  name: 'voicelab'
  params: {
    name: 'voicelab'
    ingressTargetPort: 8000
    ingressExternal: true
    ingressTransport: 'http'
    customDomains: voicelabCustomDomains
    ipSecurityRestrictions: ingressAllowedSourceRanges
    corsPolicy: {
      allowCredentials: true
      allowedHeaders: [
        'Content-Type'
        'Authorization'
        'X-Requested-With'
      ]
      allowedMethods: [
        'GET'
        'POST'
        'PUT'
        'DELETE'
        'OPTIONS'
      ]
      allowedOrigins: union(
        [
          'https://sen.wulo.ai'
          'https://staging-sen.wulo.ai'
          defaultVoicelabHost
        ],
        !empty(resolvedPublicAppUrl) ? [resolvedPublicAppUrl] : []
      )
    }
    scaleMinReplicas: 1
    scaleMaxReplicas: 1
    secrets: {
      secureList: useKeyVault ? voicelabKeyVaultSecrets : voicelabInlineSecrets
    }
    volumes: [
      // Durable cross-run agent-mesh history on the shared Azure Files share.
      // The scheduled `voicelab-agent-mesh-obs` Job writes verdict + agent_eval
      // records here; mounting the same share on the API lets the observability
      // dashboard read them back, so the gate-2 tiles survive restarts instead
      // of reading an ephemeral per-replica file.
      {
        name: 'agent-mesh-history'
        storageType: 'AzureFile'
        storageName: 'wulo-data'
      }
    ]
    containers: [
      {
        image: voicelabFetchLatestImage.outputs.?containers[?0].?image ?? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
        name: 'main'
        resources: {
          cpu: json('1.0')
          memory: '2.0Gi'
        }
        volumeMounts: [
          {
            volumeName: 'agent-mesh-history'
            mountPath: '/var/lib/agent-mesh'
          }
        ]
        env: concat(
          [
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: monitoring.outputs.applicationInsightsConnectionString
            }
            {
              name: 'APPLICATIONINSIGHTS_RESOURCE_ID'
              value: monitoring.outputs.applicationInsightsResourceId
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: voicelabIdentity.outputs.clientId
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: aiFoundryResource.properties.endpoint
            }
            {
              name: 'PROJECT_ENDPOINT'
              value: '${aiFoundryResource.properties.endpoint}api/projects/default-project'
            }
            {
              name: 'MODEL_DEPLOYMENT_NAME'
              value: gptDeploymentName
            }
            {
              name: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT'
              value: 'text-embedding-3-small'
            }
            {
              name: 'PATHFINDER_RAG_EMBEDDINGS_ENABLED'
              value: '1'
            }
            {
              name: 'AZURE_SPEECH_KEY'
              secretRef: 'speech-api-key'
            }
            {
              name: 'AZURE_SPEECH_REGION'
              value: 'swedencentral'
            }
            {
              name: 'AZURE_SPEECH_ENDPOINT'
              value: speechService.properties.endpoint
            }
            {
              name: 'AZURE_AI_RESOURCE_NAME'
              value: aiFoundryResource.name
            }
            {
              name: 'AZURE_AI_REGION'
              value: 'swedencentral'
            }
            {
              name: 'SUBSCRIPTION_ID'
              value: subscription().subscriptionId
            }
            {
              name: 'RESOURCE_GROUP_NAME'
              value: resourceGroup().name
            }
            {
              name: 'USE_AZURE_AI_AGENTS'
              value: useFoundryAgents ? 'true' : 'false'
            }
            {
              name: 'PORT'
              value: '8000'
            }
            {
              name: 'HOST'
              value: '0.0.0.0'
            }
            {
              name: 'AZD_ENV_NAME'
              value: environmentName
            }
            {
              name: 'PUBLIC_APP_URL'
              value: resolvedPublicAppUrl
            }
            {
              name: 'DATABASE_BACKEND'
              value: databaseBackend
            }
            {
              name: 'DATABASE_RUN_MIGRATIONS_ON_STARTUP'
              value: databaseRunMigrationsOnStartup ? 'true' : 'false'
            }
            {
              name: 'DATABASE_MIGRATION_ALLOWED_ENVIRONMENTS'
              value: databaseMigrationAllowedEnvironments
            }
            {
              name: 'PATHFINDER_LEARN_OBSERVABILITY_ENABLED'
              value: pathfinderLearnObservabilityEnabled
            }
            {
              name: 'PATHFINDER_LEARN_PROMETHEUS_ENABLED'
              value: pathfinderLearnPrometheusEnabled
            }
            {
              name: 'PATHFINDER_LEARN_OTEL_ENABLED'
              value: pathfinderLearnOtelEnabled
            }
            {
              name: 'PATHFINDER_VOICELIVE_ENABLED'
              value: pathfinderVoiceliveEnabled
            }
            {
              name: 'PATHFINDER_VOICE_ENABLED'
              value: pathfinderVoiceEnabled
            }
            {
              name: 'PATHFINDER_ASSISTANT_LLM_ENABLED'
              value: pathfinderAssistantLlmEnabled
            }
            {
              name: 'PATHFINDER_ASSISTANT_MODEL_DEPLOYMENT'
              value: pathfinderAssistantModelDeployment
            }
            {
              name: 'PATHFINDER_B2C_ONBOARDING_ENABLED'
              value: 'true'
            }
            {
              name: 'PATHFINDER_LEARNER_ONBOARDING_ENABLED'
              value: 'true'
            }
            {
              name: 'PATHFINDER_GOAL_INTAKE_ENABLED'
              value: 'true'
            }
            {
              name: 'STORAGE_PATH'
              value: '/tmp/wulo.db'
            }
            {
              name: 'BLOB_BACKUP_ACCOUNT_NAME'
              value: persistenceStorage.name
            }
            {
              // Durable agent-mesh history the dashboard reads — the same path the
              // scheduled observability Job writes on the shared Azure Files mount.
              name: 'AGENT_MESH_HISTORY_PATH'
              value: '/var/lib/agent-mesh/history.jsonl'
            }
            {
              name: 'COPILOT_CLI_PATH'
              value: empty(copilotCliPath) ? '/usr/local/bin/copilot' : copilotCliPath
            }
            {
              name: 'VOICE_LIVE_MODEL'
              value: empty(voiceLiveModel) ? gptDeploymentName : voiceLiveModel
            }
            {
              name: 'AZURE_INPUT_TRANSCRIPTION_MODEL'
              value: empty(inputTranscriptionModel) ? 'azure-speech' : inputTranscriptionModel
            }
            {
              name: 'COPILOT_PLANNER_MODEL'
              value: empty(copilotPlannerModel) ? gptDeploymentName : copilotPlannerModel
            }
            {
              name: 'COPILOT_PLANNER_REASONING_EFFORT'
              value: copilotPlannerReasoningEffort
            }
            {
              name: 'COPILOT_AZURE_API_VERSION'
              value: empty(copilotAzureApiVersion) ? '2024-10-21' : copilotAzureApiVersion
            }
            {
              name: 'AZURE_COMMUNICATION_SERVICES_SENDER_ADDRESS'
              value: azureCommunicationServicesSenderAddress
            }
            {
              name: 'AZURE_COMMUNICATION_SERVICES_SENDER_DISPLAY_NAME'
              value: azureCommunicationServicesSenderDisplayName
            }
            {
              name: 'ADMIN_EMAIL'
              value: safeguardingAdminEmail
            }
            {
              name: 'ADMIN_SMS_TO'
              value: safeguardingAdminSmsTo
            }
            {
              name: 'TWILIO_FROM_NUMBER'
              value: twilioFromNumber
            }
            {
              name: 'AZURE_CONTENT_SAFETY_ENDPOINT'
              value: azureContentSafetyEndpoint
            }
            {
              name: 'SAFEGUARDING_SHADOW_MODE'
              value: safeguardingShadowMode ? '1' : '0'
            }
            {
              // Pin the L3 LLM safeguarding classifier to a model that is
              // actually deployed on this Foundry resource. The code default
              // (gpt-4o-mini) is NOT deployed here, so without this pin the
              // classifier's create() call 404s and the layer fails open to
              // NONE — silently disabling nuanced disclosure detection. gpt-4o
              // is deployed and is a stronger model for soft disclosures.
              name: 'SAFEGUARDING_CLASSIFIER_MODEL'
              value: gptDeploymentName
            }
          ],
          enablePostgresPersistence
            ? [
                {
                  name: 'DATABASE_URL'
                  secretRef: 'postgres-database-url'
                }
                {
                  name: 'DATABASE_ADMIN_URL'
                  secretRef: 'postgres-admin-database-url'
                }
              ]
            : [],
          !empty(copilotGithubToken)
            ? [
                {
                  name: 'COPILOT_GITHUB_TOKEN'
                  secretRef: 'copilot-github-token'
                }
              ]
            : [],
          !empty(microsoftProviderClientSecret)
            ? [
                {
                  name: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
                  secretRef: 'microsoft-provider-auth-secret'
                }
              ]
            : [],
          !empty(googleProviderClientSecret)
            ? [
                {
                  name: 'GOOGLE_PROVIDER_AUTHENTICATION_SECRET'
                  secretRef: 'google-provider-auth-secret'
                }
              ]
            : [],
          !empty(azureCommunicationServicesConnectionString) || enableAzureCommunicationServicesEmail
            ? [
                {
                  name: 'AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING'
                  secretRef: 'azure-communication-services-connection-string'
                }
              ]
            : [],
          !empty(twilioAuthToken)
            ? [
                {
                  name: 'TWILIO_ACCOUNT_SID'
                  secretRef: 'twilio-account-sid'
                }
                {
                  name: 'TWILIO_AUTH_TOKEN'
                  secretRef: 'twilio-auth-token'
                }
              ]
            : [],
          !empty(azureContentSafetyKey)
            ? [
                {
                  name: 'AZURE_CONTENT_SAFETY_KEY'
                  secretRef: 'azure-content-safety-key'
                }
              ]
            : []
        )
      }
    ]
    managedIdentities: {
      systemAssigned: false
      userAssignedResourceIds: [voicelabIdentity.outputs.resourceId]
    }
    registries: [
      {
        server: containerRegistry.outputs.loginServer
        identity: voicelabIdentity.outputs.resourceId
      }
    ]
    environmentResourceId: containerAppsEnvironment.outputs.resourceId
    location: location
    tags: union(tags, { 'azd-service-name': 'voicelab' })
  }
  dependsOn: [
    containerAppsManagedEnvironmentStorage
    keyVaultSecrets
    keyVaultSecretsUserAssignment
    privateEndpoints
  ]
}

// Pathfinder W8 — Web Push spaced-retrieval dispatcher.
// Runs `python -m src.learning.notifications_dispatcher` once on a cron
// schedule, reusing the voicelab container image so we ship the same code
// path that the API uses. Only provisioned when VAPID keys are supplied.
var voicelabIdentityName = '${abbrs.managedIdentityUserAssignedIdentities}voicelab-${resourceToken}'
var voicelabIdentityResourceId = resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', voicelabIdentityName)

resource notificationsDispatcherJob 'Microsoft.App/jobs@2024-03-01' = if (enablePostgresPersistence && !empty(vapidPublicKey) && !empty(vapidPrivateKey)) {
  name: 'voicelab-notifications-dispatcher'
  location: location
  tags: union(tags, { 'azd-service-name': 'voicelab-notifications-dispatcher' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${voicelabIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironment.outputs.resourceId
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 300
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        cronExpression: notificationsDispatcherCron
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: containerRegistry.outputs.loginServer
          identity: voicelabIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'postgres-database-url'
          value: postgresRuntimeConnectionString
        }
        {
          name: 'vapid-public-key'
          value: vapidPublicKey
        }
        {
          name: 'vapid-private-key'
          value: vapidPrivateKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'dispatcher'
          image: voicelabFetchLatestImage.outputs.?containers[?0].?image ?? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          command: [
            'python'
            '-m'
            'src.learning.notifications_dispatcher'
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              secretRef: 'postgres-database-url'
            }
            {
              name: 'VAPID_PUBLIC_KEY'
              secretRef: 'vapid-public-key'
            }
            {
              name: 'VAPID_PRIVATE_KEY'
              secretRef: 'vapid-private-key'
            }
            {
              name: 'VAPID_SUBJECT'
              value: vapidSubject
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: voicelabIdentity.outputs.clientId
            }
          ]
        }
      ]
    }
  }
}


// Agent-mesh gate 2 — observability cron (Track A, increment 7).
//
// Re-expresses backend/deploy/agent-mesh-cron.yaml (a k8s CronJob scaffold that
// can NEVER apply on this runtime) as the real Container Apps primitive: a
// scheduled `Microsoft.App/jobs`. It reuses the voicelab image and mounts the
// EXISTING `wulo-data` Azure Files share (via the managedEnvironments/storages
// resource) at /var/lib/agent-mesh — no PVC, no AKS.
//
// DARK BY DEFAULT, two independent gates:
//   (1) enableAgentMeshObservabilityCron=false → the Job is not provisioned.
//   (2) AGENT_MESH_ENABLED comes from agentMeshObservabilityEnabled (default "")
//       → scripts/agent_mesh_cron.sh runs no agents and exits 0 (a no-op).
// Flipping either alone is still dark. Both flips are deliberate human actions.
resource agentMeshObservabilityJob 'Microsoft.App/jobs@2024-03-01' = if (enableAgentMeshObservabilityCron) {
  name: 'voicelab-agent-mesh-obs'
  location: location
  tags: union(tags, { 'azd-service-name': 'voicelab-agent-mesh-obs' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${voicelabIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironment.outputs.resourceId
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 300
      replicaRetryLimit: 0
      scheduleTriggerConfig: {
        cronExpression: agentMeshObservabilityCron
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: containerRegistry.outputs.loginServer
          identity: voicelabIdentityResourceId
        }
      ]
    }
    template: {
      volumes: [
        {
          name: 'agent-mesh-history'
          storageType: 'AzureFile'
          storageName: 'wulo-data'
        }
      ]
      containers: [
        {
          name: 'observability-gate'
          image: voicelabFetchLatestImage.outputs.?containers[?0].?image ?? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          command: [
            'bash'
            'scripts/agent_mesh_cron.sh'
            '/var/lib/agent-mesh/history.jsonl'
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          volumeMounts: [
            {
              volumeName: 'agent-mesh-history'
              mountPath: '/var/lib/agent-mesh'
            }
          ]
          env: [
            // Master kill-switch — dark unless agentMeshObservabilityEnabled="1".
            {
              name: 'AGENT_MESH_ENABLED'
              value: agentMeshObservabilityEnabled
            }
            // Durable cross-run history path on the mounted Azure Files share.
            {
              name: 'AGENT_MESH_HISTORY_PATH'
              value: '/var/lib/agent-mesh/history.jsonl'
            }
            // Per-feature flags follow the master flag; arm individually at go-live.
            {
              name: 'AGENT_MESH_MEMORY_SINK_V1'
              value: agentMeshObservabilityEnabled
            }
            {
              name: 'LEARNING_SAFEGUARDING_PROBES_V1'
              value: agentMeshObservabilityEnabled
            }
            {
              name: 'LEARNING_CRITIC_PROBES_V1'
              value: agentMeshObservabilityEnabled
            }
            // Default safety probe set behind the genaiops merge-gate. Without
            // this the merge-gate verdict is `gate_skipped` (fail-closed) even
            // though safeguarding/critic pass — arm it so the offline release
            // eval can actually certify a pass.
            {
              name: 'LEARNING_SAFETY_PROBES_V1'
              value: agentMeshObservabilityEnabled
            }
            // Eval harness kill-switch. The genaiops gate needs BOTH the probe
            // set (above) and the harness armed; with the harness unset the
            // verdict is still `gate_skipped` ("eval harness gated by
            // LEARNING_EVAL_HARNESS_V1"). Arm it to actually run the probes.
            {
              name: 'LEARNING_EVAL_HARNESS_V1'
              value: agentMeshObservabilityEnabled
            }
            {
              name: 'AGENT_MESH_DRIFT_V1'
              value: agentMeshObservabilityEnabled
            }
            {
              name: 'AGENT_MESH_ROLLBACK_V1'
              value: agentMeshObservabilityEnabled
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: voicelabIdentity.outputs.clientId
            }
          ]
        }
      ]
    }
  }
  dependsOn: [
    containerAppsManagedEnvironmentStorage
  ]
}


module ralphLrs 'br/public:avm/res/app/container-app:0.8.0' = if (enableRalphLrs && !empty(ralphLrsImage)) {
  name: 'ralph-lrs'
  params: {
    name: 'ralph-lrs'
    ingressTargetPort: 8100
    ingressExternal: false
    ingressTransport: 'http'
    scaleMinReplicas: 0
    scaleMaxReplicas: 1
    secrets: {
      secureList: concat(
        enablePostgresPersistence
          ? [
              {
                name: 'postgres-database-url'
                value: postgresRuntimeConnectionString
              }
            ]
          : [],
        !empty(ralphLrsAdminToken)
          ? [
              {
                name: 'ralph-admin-token'
                value: ralphLrsAdminToken
              }
            ]
          : []
      )
    }
    volumes: []
    containers: [
      {
        image: ralphLrsImage
        name: 'main'
        resources: {
          cpu: json('0.5')
          memory: '1.0Gi'
        }
        volumeMounts: []
        env: concat(
          enablePostgresPersistence
            ? [
                {
                  name: 'DATABASE_URL'
                  secretRef: 'postgres-database-url'
                }
              ]
            : [],
          !empty(ralphLrsAdminToken)
            ? [
                {
                  name: 'RALPH_ADMIN_TOKEN'
                  secretRef: 'ralph-admin-token'
                }
              ]
            : []
        )
      }
    ]
    managedIdentities: {
      systemAssigned: false
      userAssignedResourceIds: [voicelabIdentity.outputs.resourceId]
    }
    environmentResourceId: containerAppsEnvironment.outputs.resourceId
    location: location
    tags: union(tags, { 'azd-service-name': 'ralph-lrs' })
  }
}

resource voicelabAuth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (easyAuthEnabled) {
  parent: voicelabContainerApp
  name: 'current'
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      unauthenticatedClientAction: 'Return401'
      excludedPaths: [
        '/'
        '/index.html'
        '/login'
        '/onboarding'
        '/mode'
        '/home'
        '/dashboard'
        '/settings'
        '/session'
        '/assets/*'
        '/js/*'
        '/manifest.json'
        '/api/health'
        '/logout'
        '/wulo-logo.png'
        '/favicon.ico'
        '/privacy'
        '/terms'
        '/ai-transparency'
      ]
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: !empty(microsoftProviderClientId)
        registration: {
          clientId: microsoftProviderClientId
          clientSecretSettingName: 'microsoft-provider-auth-secret'
          openIdIssuer: '${environment().authentication.loginEndpoint}common/v2.0'
        }
        login: {
          loginParameters: [
            'scope=openid profile email'
          ]
        }
      }
      google: {
        enabled: !empty(googleProviderClientId)
        registration: {
          clientId: googleProviderClientId
          clientSecretSettingName: 'google-provider-auth-secret'
        }
        login: {
          scopes: [
            'openid'
            'profile'
            'email'
          ]
        }
      }
    }
    login: {
      tokenStore: {
        enabled: false
      }
      allowedExternalRedirectUrls: empty(resolvedRedirectHost)
        ? [
            defaultVoicelabHost
          ]
        : [
            resolvedRedirectHost
            defaultVoicelabHost
          ]
    }
    httpSettings: {
      requireHttps: true
    }
  }
  dependsOn: [
    voicelab
  ]
}

resource containerAppAzureAIDeveloperRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, voicelab.name, '64702f94-c441-49e6-a78b-ef80e0188fee')
  properties: {
    principalId: voicelabIdentity.outputs.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', '64702f94-c441-49e6-a78b-ef80e0188fee')
  }
}

resource containerAppCognitiveServicesUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, voicelab.name, 'a97b65f3-24c7-4388-baec-2e87135dc908')
  properties: {
    principalId: voicelabIdentity.outputs.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908')
  }
}

resource containerAppCognitiveServicesOpenAIUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, voicelab.name, '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  properties: {
    principalId: voicelabIdentity.outputs.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  }
}

resource containerAppMonitoringReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, voicelab.name, '43d0d8ad-25c7-4714-9337-8ba259a9fe05')
  properties: {
    principalId: voicelabIdentity.outputs.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', '43d0d8ad-25c7-4714-9337-8ba259a9fe05')
  }
}

resource userAzureAIDeveloperRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(principalId)) {
  name: guid(resourceGroup().id, principalId, '64702f94-c441-49e6-a78b-ef80e0188fee')
  properties: {
    principalId: principalId
    principalType: principalType
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', '64702f94-c441-49e6-a78b-ef80e0188fee')
  }
}

resource userCognitiveServicesOpenAIUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(principalId)) {
  name: guid(resourceGroup().id, principalId, '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  properties: {
    principalId: principalId
    principalType: principalType
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.outputs.loginServer
output AZURE_RESOURCE_VOICELAB_ID string = voicelab.outputs.resourceId
output AZURE_CONTAINER_APP_ENVIRONMENT_NAME string = containerAppsEnvironment.name
output AZURE_CONTAINER_APP_NAME string = voicelab.name
output SERVICE_VOICELAB_URI string = 'https://${voicelab.outputs.fqdn}'
output AZURE_TENANT_ID string = subscription().tenantId
output AZURE_SUBSCRIPTION_ID string = subscription().subscriptionId
output VOICELAB_IDENTITY_PRINCIPAL_ID string = voicelabIdentity.outputs.principalId
output PROJECT_ENDPOINT string = '${aiFoundryResource.properties.endpoint}api/projects/default-project'
output AZURE_OPENAI_ENDPOINT string = aiFoundryResource.properties.endpoint
output AZURE_SPEECH_REGION string =  location
output AI_FOUNDRY_RESOURCE_NAME string = aiFoundryResource.name
output POSTGRES_SERVER_FQDN string = enablePostgresPersistence ? postgresServer!.properties.fullyQualifiedDomainName : ''
output POSTGRES_DATABASE_NAME string = enablePostgresPersistence ? postgresDatabaseName : ''
output AZURE_COMMUNICATION_SERVICE_NAME string = enableAzureCommunicationServicesEmail ? communicationService.name : ''
output AZURE_EMAIL_COMMUNICATION_SERVICE_NAME string = enableAzureCommunicationServicesEmail ? emailService.name : ''
output RALPH_LRS_URI string = enableRalphLrs && !empty(ralphLrsImage) ? 'https://${ralphLrs!.outputs.fqdn}' : ''
