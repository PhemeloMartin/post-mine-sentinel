variable "environment" {
  description = "Deployment stage (staging | prod)."
  type        = string
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod."
  }
}

variable "location" {
  description = "Primary region. South Africa North keeps personal information in-country (POPIA s72)."
  type        = string
  default     = "southafricanorth"
}

variable "aks_admin_group_object_ids" {
  description = "Entra ID groups granted cluster-admin through Azure RBAC (no local accounts)."
  type        = list(string)
}

variable "soc_egress_cidrs" {
  description = "Public CIDRs of the SOC networks allowed to reach the console and the Key Vault."
  type        = list(string)
}

variable "tags" {
  type    = map(string)
  default = { project = "post-mine-sentinel", data-classification = "restricted", owner = "sentinel-platform" }
}
