data "azurerm_client_config" "current" {}

locals {
  name = "sentinel-${var.environment}"
  tags = merge(var.tags, { environment = var.environment })
}

resource "azurerm_resource_group" "this" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

# ---------------------------------------------------------------- network

resource "azurerm_virtual_network" "this" {
  name                = "vnet-${local.name}"
  resource_group_name = azurerm_resource_group.this.name
  location            = var.location
  address_space       = ["10.20.0.0/16"]
  tags                = local.tags
}

resource "azurerm_subnet" "aks" {
  name                 = "snet-aks"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = ["10.20.0.0/23"]
}

resource "azurerm_subnet" "postgres" {
  name                 = "snet-postgres"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = ["10.20.2.0/24"]
  service_endpoints    = ["Microsoft.Storage"]
  delegation {
    name = "postgres"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_private_dns_zone" "postgres" {
  name                = "${local.name}.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "postgres-link"
  resource_group_name   = azurerm_resource_group.this.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.this.id
}

# ---------------------------------------------------------------- observability

resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-${local.name}"
  resource_group_name = azurerm_resource_group.this.name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 90
  tags                = local.tags
}

# ---------------------------------------------------------------- kubernetes

resource "azurerm_kubernetes_cluster" "this" {
  name                      = "aks-${local.name}"
  resource_group_name       = azurerm_resource_group.this.name
  location                  = var.location
  dns_prefix                = local.name
  sku_tier                  = var.environment == "prod" ? "Standard" : "Free"
  oidc_issuer_enabled       = true
  workload_identity_enabled = true
  local_account_disabled    = true
  azure_policy_enabled      = true

  default_node_pool {
    name                 = "system"
    vm_size              = "Standard_D4ds_v5"
    vnet_subnet_id       = azurerm_subnet.aks.id
    zones                = ["1", "2", "3"]
    auto_scaling_enabled = true
    min_count            = 2
    max_count            = 6
    upgrade_settings { max_surge = "33%" }
  }

  identity { type = "SystemAssigned" }

  azure_active_directory_role_based_access_control {
    azure_rbac_enabled     = true
    tenant_id              = data.azurerm_client_config.current.tenant_id
    admin_group_object_ids = var.aks_admin_group_object_ids
  }

  network_profile {
    network_plugin    = "azure"
    network_policy    = "azure"
    load_balancer_sku = "standard"
  }

  key_vault_secrets_provider {
    secret_rotation_enabled  = true
    secret_rotation_interval = "5m"
  }

  oms_agent { log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id }
  tags = local.tags
}

# ---------------------------------------------------------------- database

resource "random_password" "pg_admin" {
  length  = 32
  special = true
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                          = "psql-${local.name}"
  resource_group_name           = azurerm_resource_group.this.name
  location                      = var.location
  version                       = "16"
  delegated_subnet_id           = azurerm_subnet.postgres.id
  private_dns_zone_id           = azurerm_private_dns_zone.postgres.id
  public_network_access_enabled = false
  administrator_login           = "sentinel_admin"
  administrator_password        = random_password.pg_admin.result
  sku_name                      = var.environment == "prod" ? "GP_Standard_D4ds_v5" : "B_Standard_B2s"
  storage_mb                    = 131072
  backup_retention_days         = 35
  geo_redundant_backup_enabled  = var.environment == "prod" # paired region: South Africa West
  zone                          = "1"

  dynamic "high_availability" {
    for_each = var.environment == "prod" ? [1] : []
    content {
      mode                      = "ZoneRedundant"
      standby_availability_zone = "2"
    }
  }

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = true
    tenant_id                     = data.azurerm_client_config.current.tenant_id
  }
  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
  tags       = local.tags
}

resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "POSTGIS,TIMESCALEDB,PGCRYPTO"
}

resource "azurerm_postgresql_flexible_server_configuration" "preload" {
  name      = "shared_preload_libraries"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "timescaledb,pg_stat_statements"
}

resource "azurerm_postgresql_flexible_server_database" "sentinel" {
  name      = "sentinel"
  server_id = azurerm_postgresql_flexible_server.this.id
}

resource "azurerm_postgresql_flexible_server_database" "cases" {
  name      = "sentinel_cases"
  server_id = azurerm_postgresql_flexible_server.this.id
}

# ---------------------------------------------------------------- secrets

resource "azurerm_key_vault" "this" {
  name                          = "kv-${local.name}"
  resource_group_name           = azurerm_resource_group.this.name
  location                      = var.location
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "premium" # HSM-backed keys for SilkNet site keys & evidence signing
  enable_rbac_authorization     = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  public_network_access_enabled = true
  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
    ip_rules       = var.soc_egress_cidrs
  }
  tags = local.tags
}

resource "azurerm_key_vault_secret" "pg_admin" {
  name         = "postgres-admin-password"
  value        = random_password.pg_admin.result
  key_vault_id = azurerm_key_vault.this.id
  content_type = "password"
}

resource "azurerm_user_assigned_identity" "workload" {
  name                = "id-${local.name}-workload"
  resource_group_name = azurerm_resource_group.this.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "workload" {
  name                = "sentinel-workload"
  resource_group_name = azurerm_resource_group.this.name
  parent_id           = azurerm_user_assigned_identity.workload.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = azurerm_kubernetes_cluster.this.oidc_issuer_url
  subject             = "system:serviceaccount:sentinel:sentinel-workload"
}

resource "azurerm_role_assignment" "workload_secrets" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.workload.principal_id
}

# ---------------------------------------------------------------- evidence store (WORM)

resource "azurerm_storage_account" "evidence" {
  name                            = replace("st${local.name}evd", "-", "")
  resource_group_name             = azurerm_resource_group.this.name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "ZRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  blob_properties {
    versioning_enabled = true
    delete_retention_policy { days = 30 }
  }
  # Write-once-read-many: evidence and audit exports cannot be altered or deleted for 7 years.
  immutability_policy {
    allow_protected_append_writes = true
    state                         = "Unlocked" # lock after legal sign-off; locking is irreversible
    period_since_creation_in_days = 2557
  }
  tags = local.tags
}

resource "azurerm_role_assignment" "workload_evidence" {
  scope                = azurerm_storage_account.evidence.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.workload.principal_id
}
