using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Sentinel.Cases.Api.Data;
using Sentinel.Cases.Api.Endpoints;
using Sentinel.Cases.Api.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// ---- Observability: structured JSON logs with trace/span ids for correlation across services.
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(o =>
{
    o.IncludeScopes = true;
    o.UseUtcTimestamp = true;
    o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
});

// ---- Errors: RFC 7807 everywhere (exceptions, 404s, 405s, auth failures).
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
    ctx.ProblemDetails.Extensions.TryAdd("traceId", ctx.HttpContext.TraceIdentifier));
builder.Services.AddExceptionHandler<ProblemDetailsExceptionHandler>();

// ---- Persistence: PostgreSQL (Npgsql) in deployed envs, SQLite for local runs and tests.
var cs = builder.Configuration.GetConnectionString("Cases") ?? "Data Source=cases-dev.db";
builder.Services.AddDbContext<CasesDbContext>(o =>
{
    if (cs.StartsWith("Host=", StringComparison.OrdinalIgnoreCase))
    {
        o.UseNpgsql(cs, npg => npg.EnableRetryOnFailure(maxRetryCount: 5)); // transient-fault resilience
    }
    else
    {
        o.UseSqlite(cs);
    }
});

// ---- AuthN/AuthZ: validates the same HS256 JWTs the Python API issues (shared issuer/audience).
var jwt = builder.Configuration.GetSection("Jwt");
var secret = jwt["Secret"];
if (string.IsNullOrWhiteSpace(secret) || Encoding.UTF8.GetByteCount(secret) < 32)
{
    throw new InvalidOperationException("Jwt:Secret must be configured with at least 32 bytes (256-bit HMAC key).");
}

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = jwt["Issuer"] ?? "post-mine-sentinel",
        ValidAudience = jwt["Audience"] ?? "sentinel-console",
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
        ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
        RoleClaimType = "role",
        NameClaimType = "sub",
        ClockSkew = TimeSpan.FromSeconds(30),
    };
});
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(CaseEndpoints.ReadPolicy, p => p.RequireRole("admin", "analyst", "field_officer", "auditor"))
    .AddPolicy(CaseEndpoints.WritePolicy, p => p.RequireRole("admin", "analyst", "field_officer"));

builder.Services.Configure<ServiceAuthOptions>(builder.Configuration.GetSection("ServiceAuth"));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks().AddDbContextCheck<CasesDbContext>("database");

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    ctx.Response.Headers.XFrameOptions = "DENY";
    ctx.Response.Headers["Referrer-Policy"] = "no-referrer";
    await next();
});
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
app.MapHealthChecks("/health/ready");
app.MapCaseEndpoints();

// Schema: EF migrations in production pipelines; EnsureCreated for local/dev/test convenience.
if (!app.Environment.IsProduction())
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<CasesDbContext>().Database.EnsureCreated();
}

await app.RunAsync();

/// <summary>Exposed for WebApplicationFactory integration tests.</summary>
public partial class Program { }
