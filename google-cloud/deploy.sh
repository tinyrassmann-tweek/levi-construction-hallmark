#!/usr/bin/env bash
set -euo pipefail
: "${LEVI_PROJECT_ID:?Set LEVI_PROJECT_ID to your existing Google Cloud project ID.}"
LEVI_REGION="${LEVI_REGION:-us-east1}"
LEVI_SERVICE_ACCOUNT="levi-web@${LEVI_PROJECT_ID}.iam.gserviceaccount.com"
# Requires gcloud sign-in, approved billing, and a Firestore Native database.
# Use the supplied secret setup instructions; do not place values in source.
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com secretmanager.googleapis.com --project "$LEVI_PROJECT_ID"
gcloud run deploy levi-construction --source . --project "$LEVI_PROJECT_ID" --region "$LEVI_REGION" --allow-unauthenticated --service-account "$LEVI_SERVICE_ACCOUNT" --set-env-vars "ADMIN_EMAIL=${LEVI_ADMIN_EMAIL:?Set LEVI_ADMIN_EMAIL}" --set-secrets "SESSION_SECRET=levi-session-secret:latest,ADMIN_PASSWORD_HASH=levi-admin-password-hash:latest" --min-instances 0 --max-instances 2
