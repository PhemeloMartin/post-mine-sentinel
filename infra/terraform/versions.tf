terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.10" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Remote state in a locked-down storage account (created once by the platform team).
  backend "azurerm" {}
}

provider "azurerm" {
  storage_use_azuread = true # shared keys are disabled on the evidence account
  features {
    key_vault { purge_soft_delete_on_destroy = false }
    resource_group { prevent_deletion_if_contains_resources = true }
  }
}
