@description('Location for the virtual network.')
param location string

@description('Tags applied to the virtual network.')
param tags object = {}

@description('Resource token used to name the virtual network.')
param resourceToken string

@description('Address space for the virtual network.')
param vnetAddressPrefix string = '10.20.0.0/16'

@description('Address prefix for the Container Apps environment infrastructure subnet. Consumption environments require at least a /23.')
param infraSubnetPrefix string = '10.20.0.0/23'

@description('Address prefix for the private endpoint subnet.')
param privateEndpointSubnetPrefix string = '10.20.2.0/27'

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: 'vnet-voicelab-${resourceToken}'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: 'infra'
        properties: {
          addressPrefix: infraSubnetPrefix
          delegations: [
            {
              name: 'aca-delegation'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
          privateEndpointNetworkPolicies: 'Enabled'
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

output vnetResourceId string = virtualNetwork.id
output infraSubnetResourceId string = virtualNetwork.properties.subnets[0].id
output privateEndpointSubnetResourceId string = virtualNetwork.properties.subnets[1].id
