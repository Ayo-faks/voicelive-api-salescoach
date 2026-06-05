@description('Location for the private endpoints.')
param location string

@description('Tags applied to resources.')
param tags object = {}

@description('Resource token used for naming.')
param resourceToken string

@description('Resource ID of the virtual network (for private DNS zone links).')
param vnetResourceId string

@description('Resource ID of the subnet that hosts the private endpoints.')
param privateEndpointSubnetResourceId string

@description('Resource ID of the AI Foundry (Cognitive Services AIServices) account.')
param aiFoundryResourceId string

@description('Resource ID of the Speech (Cognitive Services) account.')
param speechResourceId string

@description('Resource ID of the persistence storage account.')
param storageResourceId string

@description('Create a private endpoint for PostgreSQL Flexible Server.')
param enablePostgres bool = false

@description('Resource ID of the PostgreSQL Flexible Server. Required when enablePostgres is true.')
param postgresResourceId string = ''

@description('Create a private endpoint for Key Vault.')
param enableKeyVault bool = false

@description('Resource ID of the Key Vault. Required when enableKeyVault is true.')
param keyVaultResourceId string = ''

// ---------------------------------------------------------------------------
// Private DNS zones
// ---------------------------------------------------------------------------
resource cognitiveZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.cognitiveservices.azure.com'
  location: 'global'
  tags: tags
}

resource openAiZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.openai.azure.com'
  location: 'global'
  tags: tags
}

resource blobZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
  tags: tags
}

resource fileZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.file.${environment().suffixes.storage}'
  location: 'global'
  tags: tags
}

resource postgresZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enablePostgres) {
  name: 'privatelink.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource keyVaultZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (enableKeyVault) {
  name: 'privatelink.vaultcore.azure.net'
  location: 'global'
  tags: tags
}

// ---------------------------------------------------------------------------
// VNet links
// ---------------------------------------------------------------------------
resource cognitiveLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: cognitiveZone
  name: 'link-${resourceToken}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetResourceId
    }
  }
}

resource openAiLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: openAiZone
  name: 'link-${resourceToken}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetResourceId
    }
  }
}

resource blobLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: blobZone
  name: 'link-${resourceToken}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetResourceId
    }
  }
}

resource fileLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: fileZone
  name: 'link-${resourceToken}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetResourceId
    }
  }
}

resource postgresLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enablePostgres) {
  parent: postgresZone
  name: 'link-${resourceToken}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetResourceId
    }
  }
}

resource keyVaultLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (enableKeyVault) {
  parent: keyVaultZone
  name: 'link-${resourceToken}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetResourceId
    }
  }
}

// ---------------------------------------------------------------------------
// Private endpoints + DNS zone groups
// ---------------------------------------------------------------------------
resource aiFoundryPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'pe-aifoundry-${resourceToken}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetResourceId
    }
    privateLinkServiceConnections: [
      {
        name: 'aifoundry'
        properties: {
          privateLinkServiceId: aiFoundryResourceId
          groupIds: [
            'account'
          ]
        }
      }
    ]
  }
}

resource aiFoundryDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: aiFoundryPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'cognitive'
        properties: {
          privateDnsZoneId: cognitiveZone.id
        }
      }
      {
        name: 'openai'
        properties: {
          privateDnsZoneId: openAiZone.id
        }
      }
    ]
  }
}

resource speechPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'pe-speech-${resourceToken}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetResourceId
    }
    privateLinkServiceConnections: [
      {
        name: 'speech'
        properties: {
          privateLinkServiceId: speechResourceId
          groupIds: [
            'account'
          ]
        }
      }
    ]
  }
}

resource speechDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: speechPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'cognitive'
        properties: {
          privateDnsZoneId: cognitiveZone.id
        }
      }
    ]
  }
}

resource blobPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'pe-blob-${resourceToken}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetResourceId
    }
    privateLinkServiceConnections: [
      {
        name: 'blob'
        properties: {
          privateLinkServiceId: storageResourceId
          groupIds: [
            'blob'
          ]
        }
      }
    ]
  }
}

resource blobDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: blobPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: blobZone.id
        }
      }
    ]
  }
}

resource filePrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'pe-file-${resourceToken}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetResourceId
    }
    privateLinkServiceConnections: [
      {
        name: 'file'
        properties: {
          privateLinkServiceId: storageResourceId
          groupIds: [
            'file'
          ]
        }
      }
    ]
  }
}

resource fileDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: filePrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'file'
        properties: {
          privateDnsZoneId: fileZone.id
        }
      }
    ]
  }
}

resource postgresPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = if (enablePostgres) {
  name: 'pe-postgres-${resourceToken}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetResourceId
    }
    privateLinkServiceConnections: [
      {
        name: 'postgres'
        properties: {
          privateLinkServiceId: postgresResourceId
          groupIds: [
            'postgresqlServer'
          ]
        }
      }
    ]
  }
}

resource postgresDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = if (enablePostgres) {
  parent: postgresPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'postgres'
        properties: {
          privateDnsZoneId: postgresZone.id
        }
      }
    ]
  }
}

resource keyVaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = if (enableKeyVault) {
  name: 'pe-keyvault-${resourceToken}'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetResourceId
    }
    privateLinkServiceConnections: [
      {
        name: 'keyvault'
        properties: {
          privateLinkServiceId: keyVaultResourceId
          groupIds: [
            'vault'
          ]
        }
      }
    ]
  }
}

resource keyVaultDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = if (enableKeyVault) {
  parent: keyVaultPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'vault'
        properties: {
          privateDnsZoneId: keyVaultZone.id
        }
      }
    ]
  }
}
