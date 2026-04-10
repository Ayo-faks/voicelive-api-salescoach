# Multi-Tenant Authentication Migration

## Overview

Wulo's Azure Easy Auth was reconfigured from single-tenant (AzureADMyOrg) to multi-tenant (AzureADMultipleOrgs) to allow sign-in from any Microsoft account, not just accounts within a single Azure AD directory.

**App Registration ID:** `046ebe76-1c25-4aad-b163-aa6b4ed6064c`  
**Display Name:** Wulo - Sign in  
**Staging URL:** `https://staging-sen.wulo.ai`

---

## Problems & Solutions

### 1. Missing Service Principal

**Symptom:** HTTP 401 on `/.auth/login/aad/callback`  
**Cause:** The app registration existed but had no service principal (enterprise application) in the tenant.  
**Fix:**
```bash
az ad sp create --id 046ebe76-1c25-4aad-b163-aa6b4ed6064c
```

### 2. Single-Tenant Audience

**Symptom:** External Microsoft accounts rejected at sign-in.  
**Cause:** `signInAudience` was set to `AzureADMyOrg`.  
**Fix:**
```bash
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/<object-id>" \
  --body '{"signInAudience":"AzureADMultipleOrgs"}'
```

The Easy Auth issuer URL must also match:
```
# Single-tenant (old)
https://login.microsoftonline.com/<tenant-id>/v2.0

# Multi-tenant (new)
https://login.microsoftonline.com/common/v2.0
```

This was updated via the Container App auth config REST API.

### 3. ID Token Issuance Not Enabled

**Symptom:** `AADSTS700054: response_type 'id_token' is not enabled for the application`  
**Cause:** The app registration did not have implicit grant ID tokens enabled, which Easy Auth requires.  
**Fix:**
```bash
az ad app update --id 046ebe76-1c25-4aad-b163-aa6b4ed6064c \
  --enable-id-token-issuance true
```

### 4. Auth Config Accidentally Deleted

**Symptom:** Easy Auth stopped working entirely — no login redirect.  
**Cause:** A REST PUT to the auth config endpoint with an incomplete body overwrote the entire config, effectively deleting it.  
**Lesson:** Always GET the full config first, modify in place, then PUT the complete object back. Back up the config before making changes:
```bash
az rest --method GET \
  --uri "/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.App/containerApps/{app}/authConfigs/current?api-version=2024-03-01" \
  -o json > /tmp/auth-config-backup.json
```

---

## Diagnostic Tools

Errors were found in **Log Analytics** (workspace `log-e5dj24rvkgx2c` in `rg-salescoach-swe`):

```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "voicelab"
| where Log_s contains "AADSTS" or Log_s contains "401"
| order by TimeGenerated desc
| take 20
```

---

## Final Configuration

| Setting | Value |
|---|---|
| signInAudience | AzureADMultipleOrgs |
| Issuer URL | `https://login.microsoftonline.com/common/v2.0` |
| ID token issuance | Enabled |
| Service principal | Created |
| Token store | Disabled (not required for current flow) |
