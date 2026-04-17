#!/usr/bin/env pwsh

Write-Host "Get Nerdbank Git Version."

nbgv get-version -f json | Out-File .\nbgv-version.json

.\GenerateVersioningTargets.ps1

docker build -f ./AzureArchitectureStudio.Server/Dockerfile -t azurearchitecturestudioserver --force-rm .

Remove-Item -Path .\nbgv-version.json, .\Directory.Build.targets

Write-Host "Build completed."