#See https://aka.ms/containerfastmode to understand how Visual Studio uses this Dockerfile to build your images for faster debugging.

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443

# ---------------------------------------------------------------------------
# Build the React SPA (Vite) and emit it to /web/dist
# ---------------------------------------------------------------------------
FROM node:20-alpine AS web
WORKDIR /web
COPY ["AzureArchitectureStudio.Web/package.json", "AzureArchitectureStudio.Web/package-lock.json*", "./"]
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY ["AzureArchitectureStudio.Web/", "./"]
RUN npm run build

# ---------------------------------------------------------------------------
# Build & publish the ASP.NET Core server
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["AzureArchitectureStudio.Server/AzureArchitectureStudio.Server.csproj", "AzureArchitectureStudio.Server/"]
COPY ["AzureArchitectureStudio.SharedModels/AzureArchitectureStudio.SharedModels.csproj", "AzureArchitectureStudio.SharedModels/"]
RUN dotnet restore "AzureArchitectureStudio.Server/AzureArchitectureStudio.Server.csproj"
COPY ["AzureArchitectureStudio.Server/", "AzureArchitectureStudio.Server/"]
COPY ["AzureArchitectureStudio.SharedModels/", "AzureArchitectureStudio.SharedModels/"]
# Bring in versioning artifacts produced by DockerBuild.ps1 (if present).
COPY ["nbgv-version.json", "./"]
COPY ["Directory.Build.targets", "./"]
WORKDIR "/src/AzureArchitectureStudio.Server"
RUN dotnet build "AzureArchitectureStudio.Server.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "AzureArchitectureStudio.Server.csproj" -c Release -o /app/publish /p:UseAppHost=false

# ---------------------------------------------------------------------------
# Final runtime image
# ---------------------------------------------------------------------------
FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
# Drop the built SPA into wwwroot so app.UseStaticFiles + MapFallbackToFile("index.html") work.
COPY --from=web /web/dist ./wwwroot
ENTRYPOINT ["dotnet", "AzureArchitectureStudio.Server.dll"]
