# Azure Architecture Studio

Azure Architecture Studio is a web application designed to simplify and streamline the process of creating solution architectures for Azure. With a focus on ease of use, efficiency, and consistency, it offers several key features:

- **Visual design**: Create solution architecture for Azure using a visually appealing and consistent styling.
- **Validation**: Ensure your design adheres to the rules and constraints of Azure resources to reduce errors.
- **Export**: Export your design as images for easy integration into your documents and presentations.
- **Cloud storage**: Save your design in the cloud for convenient access from any location.
- **Infrastructure as Code (IaC) generation**: Automatically generate IaC for your design, with support for both ARM templates and Bicep.

The primary goal of Azure Architecture Studio is to help users create high-quality solution architectures for Azure while reducing the learning curve associated with ARM, Bicep and Terraform. By improving the overall user experience, Azure Architecture Studio enables more efficient design and deployment of solutions on Azure.

## Origin

Azure Architecture Studio builds on the foundation of [Azure Design Studio](https://github.com/chunliu/AzureDesignStudio), which won the [3rd Place Winner award](https://www.credly.com/badges/08684d43-a00e-418c-8cf3-4b5eb48f601f/linked_in_profile) at the **Microsoft Global Hackathon 2022**. Azure Architecture Studio is a new product for the **Microsoft Global Hackathon 2026**, with significant new features and capabilities beyond the original.

The front-end has been rebuilt from Blazor WebAssembly to a modern **React + TypeScript** SPA powered by **@xyflow/react** for the diagram canvas, while retaining the existing **ASP.NET Core (.NET 10)** server for IaC generation, deployment, and AI-assisted services.

## Screenshots

### Canvas With AI Assistant

![Azure Architecture Studio canvas with AI Assistant](assets/Screenshot%202026-06-23%20172335.png)

### SQL Server Configuration Panel

![SQL Server configuration panel](assets/Screenshot%202026-06-23%20172502.png)

### Import From Azure Dialog

![Import from Azure dialog](assets/Screenshot%202026-06-23%20172601.png)

## What's new

- **React 19 + TypeScript 5 + Vite 6** front-end replacing the previous Blazor WASM client.
- **@xyflow/react (React Flow) v12** for the diagram canvas with custom Azure node and group rendering.
- **Fluent UI v9** (`@fluentui/react-components`, `@fluentui/react-icons`) component library.
- **Azure Import**: connect to your Azure tenant via MSAL and import live resources (subscription, resource group, or management group scope) directly onto the canvas. Resources are placed inside their resource group containers and wired up with inferred dependency edges.
- **Per-resource property enrichment** during import — every resource is fetched with its full provider-specific properties so cross-references (private endpoint → target, NIC → subnet, vnet-link → DNS zone, Container App env → vnet, etc.) become real edges on the canvas.
- **Deterministic auto-layout** powered by [elkjs](https://github.com/kieler/elkjs) — both on first import and via the **Arrange** toolbar button.
- **VNet → subnet rendering**: virtual networks are emitted as group containers and their subnets are rendered as child nodes derived from the imported address space.
- **AI-assisted services** on the server (Azure OpenAI) used for describe/suggest flows.
- **gRPC-Web** between the web client and server for design and deploy contracts (see `*.proto` in `AzureArchitectureStudio.SharedModels`).


## Contribution

All feedback and suggestions are welcome. Please feel free to create an issue if you have any. 

If you want to build and debug the code locally, please follow the instruction below. All PRs are welcome too.

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js 20+](https://nodejs.org/) and npm
- Visual Studio 2022 (17.12+) **or** VS Code with the C# Dev Kit
- (Optional) Azure CLI — required if you want to use the **Azure Import** feature against your tenant
- (Optional) Docker Desktop — only needed to build the container image

### Build it locally

Clone the repo, then build/run the two halves of the app.

**Front-end (React + Vite):**

```pwsh
cd src/AzureArchitectureStudio.Web
npm install
npm run dev
```

**Server (ASP.NET Core .NET 10):**

```pwsh
cd src/AzureArchitectureStudio.Server
dotnet run --urls "https://localhost:7203;http://localhost:5203"
```

Or open `src/AzureArchitectureStudio.sln` in Visual Studio 2022, set `AzureArchitectureStudio.Server` as the startup project and press F5. Vite is configured to proxy API and gRPC calls to the server during development.

### Configuring Azure Import (optional)

The Azure Import feature requires an Entra ID app registration with delegated `https://management.azure.com/user_impersonation` permission and a SPA redirect URI matching your dev origin. Configure the client and tenant IDs in `src/AzureArchitectureStudio.Web/src/services/auth-config.ts` before signing in.

### Exporting Infrastructure

Choose **Export** in the toolbar, select a format, then choose **Download** in the preview:

- **ARM Template** downloads `azure-architecture.json`.
- **Bicep (AVM)** downloads `azure-architecture.bicep` using version-pinned [Azure Verified Modules](https://azure.github.io/Azure-Verified-Modules/). Generation runs locally in the browser, without ARM decompilation or a backend call. Module restore requires access to the public Bicep registry. AVM telemetry is disabled in the export.
- **Terraform** downloads `azure-architecture.tf.json`, Terraform's native JSON configuration syntax, containing individual AzureRM resources (provider `~> 4.81.0`). There are no ARM deployment wrappers or AzAPI fallbacks. Resources have their own Terraform lifecycle and references.

Native Terraform and AVM cover all **37 deployable curated catalog entries**, with version-pinned modules and native AzureRM resources:

| Family | Catalog coverage |
| --- | --- |
| Compute | Linux/Windows VMs, managed disks, AKS |
| Networking | VNets/subnets, NSGs, public IPs, NICs, NAT gateways, private endpoints, firewall, Bastion, application gateway, load balancer, VPN gateway, public/private DNS |
| Application hosting | App Service plans, Linux/Windows Web Apps and Function Apps, Flex Consumption functions, Static Web Apps, Container Apps/environments, Front Door, API Management |
| Data and messaging | Storage, SQL servers/databases, MySQL/PostgreSQL flexible servers, Cosmos DB, Redis, Service Bus, Event Hubs, SignalR |
| Operations | Key Vault, container registry, Log Analytics, Application Insights |

Exports target one existing resource group. Resource group, tenant, subscription, and management group containers describe existing deployment context, not resources to provision. Terraform defaults the subscription ID and resource group name from those nodes when available. Bicep must be deployed to the corresponding existing subscription/resource group. Multi-subscription and multi-resource-group exports are rejected. The broader icon gallery also contains uncurated, legacy, and nondeployable entries; this coverage does not claim every icon is an exportable resource. Unsupported types or populated unmapped properties stop the export with an error. ARM retains its separate catalog-based generator.

Native exports preserve supported diagram settings and use catalog defaults for unset properties. Synthetic subnet views become native Terraform subnet resources or AVM VNet subnet parameters. Containment/connections resolve SQL database/server, app/hosting plan, app/environment, environment/workspace/subnet, VM/subnet, NIC/NSG, gateway/public IP, NAT/public IP, and private-DNS/VNet dependencies. Other visual edges do not imply access policies, routing, or role assignments. Ambiguous dependencies fail. Missing dependency IDs, VM image offer/SKU, application backend hostnames, and workload configuration become required inputs. SQL databases must have their SQL server present and connected for AVM export because they are children of that module. Terraform addresses remain stable when nodes are rearranged or reordered.

Passwords, repository tokens, and storage credentials always become sensitive Terraform variables or secure Bicep parameters without defaults, even when the diagram contains a value. Supply secrets separately; Terraform state can still contain them. Non-Basic SQL tiers require a specific SKU input within the selected tier. WAF-enabled application gateways and Front Door require an existing WAF policy ID; the application gateway policy must use the selected WAF mode. Function hosting-plan IDs must match the selected plan type, including FC1 for Flex Consumption. Workload code and deployment workflows are not exported.

Some selectable settings cannot be represented by a target provider/module. These fail explicitly: AzureRM Service Bus zone redundancy, disabling service-managed Event Hubs Kafka, private-only Bastion, SQL federated client ID, VNet VM protection, native Go Web App runtime, and custom Static Web App workflow paths; AVM Bastion tunneling combinations conflicting with its SKU/session-recording behavior; and platform-invalid runtime/OS combinations. NSGs support Azure default inbound rules, not a custom default Allow action. The gateway AVM module is pinned to 0.10.0 to retain catalog legacy VPN SKU support; this does not guarantee those SKUs can still be provisioned. AVM settings without AzureRM equivalents remain available in Bicep where supported.

For Terraform, supply `subscription_id`, `resource_group_name`, `location` (unless defaulted from the diagram), and additional required variables shown in the file. Authenticate separately using AzureRM's supported methods, then run `terraform init`, `terraform validate`, and review `terraform plan` before applying. For Bicep, use a current Bicep compiler, restore/build the file, supply its required parameters, and review a resource-group deployment what-if. AVM can apply security defaults beyond the diagram's settings; review the pinned module documentation before deployment.

Exported Bicep module identifiers and Terraform resource labels use normalized resource names, for example `resource_prod_connectivity_eastus_vnet`. Duplicate or equivalent normalized names receive deterministic numeric suffixes. References and required-input names use the same identifiers; Azure resource names are not changed. Reordering nodes does not change identifiers, but renaming resources or changing a set of colliding names can.

Export does not deploy or confirm regional availability, naming constraints, permissions, SKU compatibility, or production readiness. Protect exported files and Terraform state. Exports previously applied with ID-based Terraform labels need `moved` blocks or `terraform state mv` to migrate to name-based addresses; review the plan before applying to avoid unintended recreation. Existing deployments made using the previous ARM-wrapper Terraform exporter require an explicit state/import migration; do not apply the new export over that state without reviewing the plan.

Run the export regression tests from `src/AzureArchitectureStudio.Web` with `npm run test:exports`. Setting `EXPORT_VALIDATION_DIR` writes full-catalog Terraform and Bicep fixtures, including runtime/security variants, for provider validation and module compilation. These checks do not deploy resources.

## Frameworks and Libraries

Azure Architecture Studio is built on top of the following frameworks and libraries:

**Front-end (`AzureArchitectureStudio.Web`):**

- [React 19](https://react.dev/) + [TypeScript 5](https://www.typescriptlang.org/) + [Vite 6](https://vitejs.dev/)
- [@xyflow/react](https://reactflow.dev/) v12 — diagram canvas
- [Fluent UI v9](https://react.fluentui.dev/) (`@fluentui/react-components`, `@fluentui/react-icons`)
- [@azure/msal-browser](https://github.com/AzureAD/microsoft-authentication-library-for-js) + `@azure/msal-react` — Entra ID sign-in for Azure Import
- [elkjs](https://github.com/kieler/elkjs) — automatic graph layout
- [html-to-image](https://github.com/bubkoo/html-to-image) — PNG/JPEG export of diagrams
- [react-router-dom v7](https://reactrouter.com/)

**Server (`AzureArchitectureStudio.Server` / .NET 10):**

- ASP.NET Core 10 (Minimal APIs + gRPC-Web)
- [Microsoft.Identity.Web](https://github.com/AzureAD/microsoft-identity-web) — server-side auth
- [Azure.Identity](https://github.com/Azure/azure-sdk-for-net) + [Azure.ResourceManager.Resources](https://github.com/Azure/azure-sdk-for-net) — ARM operations
- [Azure.AI.OpenAI](https://github.com/Azure/azure-sdk-for-net) — AI-assisted suggestions
- [Azure.Bicep.Decompiler](https://github.com/Azure/bicep) — ARM ↔ Bicep
- [Entity Framework Core 10](https://learn.microsoft.com/ef/core/) (SQL Server / InMemory)
- [Microsoft.ApplicationInsights.AspNetCore](https://github.com/microsoft/ApplicationInsights-dotnet)

**Shared / build-time:**

- [Blazor.Diagrams](https://github.com/Blazor-Diagrams/Blazor.Diagrams) — retained as a vendored reference for the Azure resource graph and IaC source generation
- Roslyn source generators (`AzureArchitectureStudio.SourceGeneration`) that emit Azure node DTOs from the curated resource catalog

## Disclaimer

Azure Architecture Studio is a personal project without any warranty. It is neither an official product from Microsoft nor supported by Microsoft. Use it at your own risk.
