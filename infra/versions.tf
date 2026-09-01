terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    # Generates the Cloud Scheduler shared secret, so nobody has to hand one
    # over and no placeholder ships as a working password.
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
