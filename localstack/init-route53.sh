#!/bin/bash
# Create a test hosted zone for Route53 integration tests
# This runs automatically when LocalStack starts

echo "Creating test hosted zone for Route53..."
awslocal route53 create-hosted-zone \
  --name test.example.com \
  --caller-reference localstack-test-$(date +%s)

echo "Route53 test hosted zone created successfully"
awslocal route53 list-hosted-zones
