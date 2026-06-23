# Azure Architecture Studio

Azure Architecture Studio is a web application designed to simplify and streamline the process of creating solution architectures for Azure. With a focus on ease of use, efficiency, and consistency, it offers several key features:

- **Visual design**: Create solution architecture for Azure using a visually appealing and consistent styling.
- **Validation**: Ensure your design adheres to the rules and constraints of Azure resources to reduce errors.
- **Export**: Export your design as images for easy integration into your documents and presentations.
- **Cloud storage**: Save your design in the cloud for convenient access from any location.
- **Infrastructure as Code (IaC) generation**: Automatically generate IaC for your design, with support for both ARM templates and Bicep.

The primary goal of Azure Architecture Studio is to help users create high-quality solution architectures for Azure while reducing the learning curve associated with ARM and Bicep. By improving the overall user experience, Azure Architecture Studio enables more efficient design and deployment of solutions on Azure.

## Origin

Azure Architecture Studio builds on the foundation of [Azure Design Studio](https://github.com/chunliu/AzureDesignStudio), which won the [3rd Place Winner award](https://www.credly.com/badges/08684d43-a00e-418c-8cf3-4b5eb48f601f/linked_in_profile) at the **Microsoft Global Hackathon 2022**. Azure Architecture Studio is a new product for the **Microsoft Global Hackathon 2026**, with significant new features and capabilities beyond the original.

The front-end has been rebuilt from Blazor WebAssembly to a modern **React + TypeScript** SPA powered by **@xyflow/react** for the diagram canvas, while retaining the existing **ASP.NET Core (.NET 10)** server for IaC generation, deployment, and AI-assisted services.

## Screenshots

### Canvas With AI Assistant

![Azure Architecture Studio canvas with AI Assistant](assets/Screenshot%202026-06-23%20172601.png)

### SQL Server Configuration Panel

![SQL Server configuration panel](assets/Screenshot%202026-06-23%20172502.png)

### Import From Azure Dialog

![Import from Azure dialog](assets/Screenshot%202026-06-23%20172335.png)

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
