#See https://aka.ms/containerfastmode to understand how Visual Studio uses this Dockerfile to build your images for faster debugging.

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ["AzureArchitectureStudio.Server/AzureArchitectureStudio.Server.csproj", "AzureArchitectureStudio.Server/"]
COPY ["AzureArchitectureStudio.SharedModels/AzureArchitectureStudio.SharedModels.csproj", "AzureArchitectureStudio.SharedModels/"]
COPY ["AzureArchitectureStudio/AzureArchitectureStudio.csproj", "AzureArchitectureStudio/"]
COPY ["AzureArchitectureStudio.Core/AzureArchitectureStudio.Core.csproj", "AzureArchitectureStudio.Core/"]
COPY ["AzureArchitectureStudio.AzureResources/AzureArchitectureStudio.AzureResources.csproj", "AzureArchitectureStudio.AzureResources/"]
COPY ["Blazor.Diagrams/src/Blazor.Diagrams.Core/Blazor.Diagrams.Core.csproj", "Blazor.Diagrams/src/Blazor.Diagrams.Core/"]
COPY ["Blazor.Diagrams/src/Blazor.Diagrams/Blazor.Diagrams.csproj", "Blazor.Diagrams/src/Blazor.Diagrams/"]
COPY ["AzureArchitectureStudio.SourceGeneration/AzureArchitectureStudio.SourceGeneration.csproj", "AzureArchitectureStudio.SourceGeneration/"]
RUN dotnet restore "AzureArchitectureStudio.Server/AzureArchitectureStudio.Server.csproj"
COPY . .
WORKDIR "/src/AzureArchitectureStudio.Server"
RUN dotnet build "AzureArchitectureStudio.Server.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "AzureArchitectureStudio.Server.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "AzureArchitectureStudio.Server.dll"]