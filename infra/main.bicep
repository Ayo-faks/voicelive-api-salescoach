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

@description('Optional custom domain bindings for the voicelab Container App ingress.')
param voicelabCustomDomains array = []

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
    enablePostgresPersistence: enablePostgresPersistence
    postgresAdminUsername: postgresAdminUsername
    postgresAdminPassword: postgresAdminPassword
    postgresDatabaseName: postgresDatabaseName
    postgresSkuName: postgresSkuName
    databaseBackend: databaseBackend
    databaseRunMigrationsOnStartup: databaseRunMigrationsOnStartup
    databaseMigrationAllowedEnvironments: databaseMigrationAllowedEnvironments
    voicelabCustomDomains: voicelabCustomDomains
    enableAzureCommunicationServicesEmail: enableAzureCommunicationServicesEmail
    azureCommunicationServicesDataLocation: azureCommunicationServicesDataLocation
    azureCommunicationServicesDomainName: azureCommunicationServicesDomainName
    azureCommunicationServicesDomainManagement: azureCommunicationServicesDomainManagement
    azureCommunicationServicesLinkVerifiedDomain: azureCommunicationServicesLinkVerifiedDomain
    azureCommunicationServicesConnectionString: azureCommunicationServicesConnectionString
    azureCommunicationServicesSenderAddress: azureCommunicationServicesSenderAddress
    azureCommunicationServicesSenderDisplayName: azureCommunicationServicesSenderDisplayName
    publicAppUrl: publicAppUrl
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
