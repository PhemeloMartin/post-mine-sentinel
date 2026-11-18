output "aks_name" { value = azurerm_kubernetes_cluster.this.name }
output "aks_oidc_issuer" { value = azurerm_kubernetes_cluster.this.oidc_issuer_url }
output "postgres_fqdn" { value = azurerm_postgresql_flexible_server.this.fqdn }
output "key_vault_name" { value = azurerm_key_vault.this.name }
output "workload_identity_client_id" { value = azurerm_user_assigned_identity.workload.client_id }
output "evidence_account" { value = azurerm_storage_account.evidence.name }
