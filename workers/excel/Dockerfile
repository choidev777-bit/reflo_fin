FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY workers/dotnet/Reflo.Contracts/ workers/dotnet/Reflo.Contracts/
COPY workers/excel/Reflo.ExcelWorker.csproj workers/excel/
RUN dotnet restore workers/excel/Reflo.ExcelWorker.csproj
COPY workers/excel/Program.cs workers/excel/WorkbookApplicationEngine.cs workers/excel/
RUN dotnet publish workers/excel/Reflo.ExcelWorker.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8092
ENTRYPOINT ["dotnet", "Reflo.ExcelWorker.dll"]
