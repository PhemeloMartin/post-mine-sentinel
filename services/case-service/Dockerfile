# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/dotnet/sdk:11.0 AS build
WORKDIR /src
COPY nuget.config Sentinel.Cases.sln ./
COPY src/Sentinel.Cases.Domain/Sentinel.Cases.Domain.csproj src/Sentinel.Cases.Domain/
COPY src/Sentinel.Cases.Api/Sentinel.Cases.Api.csproj src/Sentinel.Cases.Api/
RUN dotnet restore src/Sentinel.Cases.Api/Sentinel.Cases.Api.csproj
COPY src/ src/
RUN dotnet publish src/Sentinel.Cases.Api/Sentinel.Cases.Api.csproj -c Release -o /out --no-restore /p:UseAppHost=false

# Chiseled Ubuntu image: no shell, no package manager, non-root by default.
FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_URLS=http://+:8080 ASPNETCORE_ENVIRONMENT=Production DOTNET_gcServer=1
EXPOSE 8080
ENTRYPOINT ["dotnet", "Sentinel.Cases.Api.dll"]
