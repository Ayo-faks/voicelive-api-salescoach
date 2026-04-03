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

@description('Id of the user or app to assign application roles')
param principalId string

@description('Principal type of user or app')
param principalType string

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = uniqueString(subscription().id, resourceGroup().id, location)
var defaultVoicelabHost = 'https://voicelab.${containerAppsEnvironment.outputs.defaultDomain}'
var customRedirectHost = environmentName == 'salescoach-swe'
  ? 'https://staging-sen.wulo.ai'
  : environmentName == 'salescoach-prod'
    ? 'https://sen.wulo.ai'
    : ''
var easyAuthEnabled = !empty(microsoftProviderClientId) || !empty(googleProviderClientId)

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
    name: 'text-embedding-ada-002'
    model: 'text-embedding-ada-002'
    sku: {
      name: 'Standard'
      capacity: 10
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
    publicNetworkAccess: 'Enabled'
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
    publicNetworkAccess: 'Enabled'
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
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
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

// Container apps environment
module containerAppsEnvironment 'br/public:avm/res/app/managed-environment:0.4.5' = {
  name: 'container-apps-environment'
  params: {
    logAnalyticsWorkspaceResourceId: monitoring.outputs.logAnalyticsWorkspaceResourceId
    name: '${abbrs.appManagedEnvironments}${resourceToken}'
    location: location
    zoneRedundant: false
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
}

module voicelabIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.2.1' = {
  name: 'voicelabidentity'
  params: {
    name: '${abbrs.managedIdentityUserAssignedIdentities}voicelab-${resourceToken}'
    location: location
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
      allowedOrigins: [
        'https://sen.wulo.ai'
        'https://staging-sen.wulo.ai'
        defaultVoicelabHost
      ]
    }
    scaleMinReplicas: 1
    scaleMaxReplicas: 1
    secrets: {
      secureList: concat(
        [
          {
            name: 'ai-foundry-api-key'
            value: aiFoundryResource.listKeys().key1
          }
          {
            name: 'speech-api-key'
            value: speechService.listKeys().key1
          }
          {
            name: 'blob-backup-account-key'
            value: persistenceStorage.listKeys().keys[0].value
          }
        ],
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
          : []
      )
    }
    volumes: []
    containers: [
      {
        image: voicelabFetchLatestImage.outputs.?containers[?0].?image ?? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
        name: 'main'
        resources: {
          cpu: json('1.0')
          memory: '2.0Gi'
        }
        volumeMounts: []
        env: concat(
          [
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: monitoring.outputs.applicationInsightsConnectionString
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
              name: 'AZURE_OPENAI_API_KEY'
              secretRef: 'ai-foundry-api-key'
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
              name: 'AZURE_SPEECH_KEY'
              secretRef: 'speech-api-key'
            }
            {
              name: 'AZURE_SPEECH_REGION'
              value: 'swedencentral'
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
              name: 'STORAGE_PATH'
              value: '/tmp/wulo.db'
            }
            {
              name: 'BLOB_BACKUP_ACCOUNT_NAME'
              value: persistenceStorage.name
            }
            {
              name: 'BLOB_BACKUP_ACCOUNT_KEY'
              secretRef: 'blob-backup-account-key'
            }
            {
              name: 'COPILOT_CLI_PATH'
              value: empty(copilotCliPath) ? '/usr/local/bin/copilot' : copilotCliPath
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
          ],
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
  ]
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
        '/assets/*'
        '/js/*'
        '/manifest.json'
        '/api/health'
        '/logout'
        '/wulo-logo.png'
        '/favicon.ico'
      ]
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: !empty(microsoftProviderClientId)
        registration: {
          clientId: microsoftProviderClientId
          clientSecretSettingName: 'microsoft-provider-auth-secret'
          openIdIssuer: '${environment().authentication.loginEndpoint}organizations/v2.0'
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
      allowedExternalRedirectUrls: empty(customRedirectHost)
        ? [
            defaultVoicelabHost
          ]
        : [
            customRedirectHost
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
