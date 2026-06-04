// Azure Monitor alert rules for the Pathfinder Learn observability surface.
// Pushes notifications when the live signals that back /observability breach
// thresholds, so operators no longer have to pull the dashboard to notice
// regressions. All resources are gated on a non-empty alert email so the
// module is a no-op in environments that have not configured a recipient.

metadata description = 'Action group + scheduled-query alert rules for Pathfinder Learn (HTTP 5xx, p95 latency, Postgres auth failures, LLM token spend).'

@description('Location for the alert rules. Action groups are always global.')
param location string = resourceGroup().location

@description('Tags applied to every alert resource.')
param tags object = {}

@description('Naming suffix (resource token) to keep alert names unique per environment.')
param resourceToken string

@description('Email address that receives alert notifications. When empty, no alert resources are deployed.')
param alertEmail string = ''

@description('Resource ID of the Application Insights component backing the dashboard signals.')
param applicationInsightsResourceId string

@description('HTTP 5xx count over the evaluation window that triggers the health alert.')
param http5xxThreshold int = 5

@description('Request duration p95 (milliseconds) that triggers the latency alert.')
param latencyP95ThresholdMs int = 3000

@description('LLM spend (GBP) over the evaluation window that triggers the token-spend alert.')
param llmSpendGbpThreshold int = 50

@description('Count of blocked agent-mesh observability cycles over the window that triggers an alert.')
param meshGateBlockedThreshold int = 0

@description('Count of veto-rate drift signals over the window that triggers an alert.')
param meshVetoDriftThreshold int = 0

var deployAlerts = !empty(alertEmail)
var abbrsActionGroup = 'ag-'

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (deployAlerts) {
  name: '${abbrsActionGroup}${resourceToken}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'pfobs'
    enabled: true
    emailReceivers: [
      {
        name: 'observabilityAdmin'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

resource http5xxAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (deployAlerts) {
  name: 'pf-obs-http-5xx-${resourceToken}'
  location: location
  tags: tags
  properties: {
    displayName: 'Pathfinder Learn - HTTP 5xx rate'
    description: 'Backend is returning server errors (HTTP 5xx).'
    severity: 1
    enabled: true
    scopes: [
      applicationInsightsResourceId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'requests | where toint(resultCode) >= 500'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: http5xxThreshold
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource latencyAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (deployAlerts) {
  name: 'pf-obs-latency-p95-${resourceToken}'
  location: location
  tags: tags
  properties: {
    displayName: 'Pathfinder Learn - request latency p95'
    description: 'Request duration p95 has exceeded the latency budget.'
    severity: 2
    enabled: true
    scopes: [
      applicationInsightsResourceId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'requests | summarize AggregatedValue = percentile(duration, 95) by bin(timestamp, 5m)'
          metricMeasureColumn: 'AggregatedValue'
          timeAggregation: 'Average'
          operator: 'GreaterThan'
          threshold: latencyP95ThresholdMs
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource postgresAuthAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (deployAlerts) {
  name: 'pf-obs-postgres-auth-${resourceToken}'
  location: location
  tags: tags
  properties: {
    displayName: 'Pathfinder Learn - Postgres auth/connection failures'
    description: 'The app is failing to authenticate or connect to PostgreSQL.'
    severity: 1
    enabled: true
    scopes: [
      applicationInsightsResourceId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'union traces, exceptions | where message has "password authentication failed" or outerMessage has "password authentication failed" or message has "OperationalError" or message has "could not connect to server"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource tokenSpendAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (deployAlerts) {
  name: 'pf-obs-token-spend-${resourceToken}'
  location: location
  tags: tags
  properties: {
    displayName: 'Pathfinder Learn - LLM token spend (GBP)'
    description: 'Cumulative LLM spend has spiked over the evaluation window.'
    severity: 2
    enabled: true
    scopes: [
      applicationInsightsResourceId
    ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    criteria: {
      allOf: [
        {
          query: 'customMetrics | where name == "pathfinder_learning_llm_cost_gbp_total" | summarize AggregatedValue = sum(valueSum) by bin(timestamp, 15m)'
          metricMeasureColumn: 'AggregatedValue'
          timeAggregation: 'Total'
          operator: 'GreaterThan'
          threshold: llmSpendGbpThreshold
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource meshGateBlockedAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (deployAlerts) {
  name: 'pf-obs-mesh-gate-blocked-${resourceToken}'
  location: location
  tags: tags
  properties: {
    displayName: 'Pathfinder Learn - agent-mesh gate blocked'
    description: 'The agent-mesh observability gate reported a blocked (gate-2) cycle.'
    severity: 2
    enabled: true
    scopes: [
      applicationInsightsResourceId
    ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    criteria: {
      allOf: [
        {
          query: 'union traces, customEvents | where message has "agent_mesh.gate.blocked" or name has "agent_mesh.gate.blocked"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: meshGateBlockedThreshold
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource meshVetoDriftAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = if (deployAlerts) {
  name: 'pf-obs-mesh-veto-drift-${resourceToken}'
  location: location
  tags: tags
  properties: {
    displayName: 'Pathfinder Learn - agent-mesh veto-rate drift'
    description: 'The agent-mesh drift detector flagged safeguarding veto-rate drift (monitoring only).'
    severity: 3
    enabled: true
    scopes: [
      applicationInsightsResourceId
    ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    criteria: {
      allOf: [
        {
          query: 'union traces, customEvents | where message has "agent_mesh.drift.detected" or name has "agent_mesh.drift.detected"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: meshVetoDriftThreshold
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

@description('Resource ID of the deployed action group, or empty when alerts are disabled.')
output actionGroupResourceId string = deployAlerts ? actionGroup.id : ''
