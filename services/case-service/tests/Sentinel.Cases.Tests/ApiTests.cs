using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Sentinel.Cases.Domain;

namespace Sentinel.Cases.Tests;

public sealed class CaseServiceFactory : WebApplicationFactory<Program>
{
    public const string Secret = "integration-test-secret-0123456789abcdef-XYZ";
    public const string ServiceToken = "svc-token-for-tests";
    private readonly string _db = Path.Combine(Path.GetTempPath(), $"cases-test-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Cases", $"Data Source={_db}");
        builder.UseSetting("Jwt:Secret", Secret);
        builder.UseSetting("ServiceAuth:Token", ServiceToken);
    }

    /// <summary>Mints a token exactly like the Python API does (HS256, iss/aud/sub/role).</summary>
    public static string Token(string sub, string role)
    {
        var handler = new JsonWebTokenHandler();
        return handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = "post-mine-sentinel",
            Audience = "sentinel-console",
            Subject = new ClaimsIdentity([new Claim("sub", sub), new Claim("role", role)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Secret)), SecurityAlgorithms.HmacSha256),
        });
    }
}

public class ApiTests(CaseServiceFactory factory) : IClassFixture<CaseServiceFactory>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static object OpenBody(string alert) => new
    {
        alertRef = alert,
        mineId = "ZA-NW-002",
        level = "critical",
        posterior = 0.981,
        reason = "footsteps",
        raisedAt = DateTimeOffset.UtcNow,
        signature = new string('b', 128),
        requestedBy = "analyst",
    };

    private HttpClient Service(string idempotencyKey)
    {
        var c = factory.CreateClient();
        c.DefaultRequestHeaders.Add("X-Service-Token", CaseServiceFactory.ServiceToken);
        c.DefaultRequestHeaders.Add("Idempotency-Key", idempotencyKey);
        return c;
    }

    private HttpClient As(string sub, string role)
    {
        var c = factory.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", CaseServiceFactory.Token(sub, role));
        return c;
    }

    private async Task<string> OpenCase(string alert)
    {
        var r = await Service($"outbox-{alert}").PostAsJsonAsync("/api/cases", OpenBody(alert));
        Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync());
        return (await r.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("reference").GetString()!;
    }

    private static async Task<JsonElement> AssertProblem(HttpResponseMessage r, HttpStatusCode status, string slug)
    {
        Assert.Equal(status, r.StatusCode);
        Assert.Equal("application/problem+json", r.Content.Headers.ContentType?.MediaType);
        var body = await r.Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.EndsWith(slug, body.GetProperty("type").GetString());
        Assert.True(body.TryGetProperty("traceId", out _));
        return body;
    }

    [Fact]
    public async Task Liveness_probe_is_healthy()
    {
        var r = await factory.CreateClient().GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Opening_a_case_requires_the_service_token()
    {
        var r = await factory.CreateClient().PostAsJsonAsync("/api/cases", OpenBody("ALR-2026-000900"));
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Case_creation_is_idempotent_per_outbox_event()
    {
        var client = Service("outbox-42");
        var first = await client.PostAsJsonAsync("/api/cases", OpenBody("ALR-2026-000042"));
        var replay = await client.PostAsJsonAsync("/api/cases", OpenBody("ALR-2026-000042"));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var a = await first.Content.ReadFromJsonAsync<JsonElement>(Json);
        var b = await replay.Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.Equal(a.GetProperty("reference").GetString(), b.GetProperty("reference").GetString());
    }

    [Fact]
    public async Task Invalid_payload_returns_field_errors()
    {
        var bad = new { alertRef = "nope", mineId = "X", level = "medium", posterior = 4.2, reason = "", raisedAt = DateTimeOffset.UtcNow, signature = "short", requestedBy = "a" };
        var r = await Service("outbox-bad").PostAsJsonAsync("/api/cases", bad);
        var errors = (await AssertProblem(r, HttpStatusCode.BadRequest, "/validation")).GetProperty("errors");
        foreach (var field in new[] { "alertRef", "mineId", "posterior", "level", "signature" })
        {
            Assert.True(errors.TryGetProperty(field, out _), $"missing {field} in {errors}");
        }
    }

    [Fact]
    public async Task Reading_cases_requires_an_authorised_role()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/cases")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await As("liaison", "community_liaison").GetAsync("/api/cases")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await As("auditor", "auditor").GetAsync("/api/cases")).StatusCode);
        // Auditors may read but never change a case.
        var reference = await OpenCase("ALR-2026-000500");
        var r = await As("auditor", "auditor").PostAsJsonAsync($"/api/cases/{reference}/transitions", new { to = "Cancelled" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Unknown_case_is_404_problem()
    {
        var r = await As("analyst", "analyst").GetAsync("/api/cases/CASE-1999-000001");
        await AssertProblem(r, HttpStatusCode.NotFound, "/not-found");
    }

    [Fact]
    public async Task Illegal_transition_is_409_problem()
    {
        var reference = await OpenCase("ALR-2026-000600");
        var r = await As("analyst", "analyst").PostAsJsonAsync($"/api/cases/{reference}/transitions", new { to = "ReferredToNpa" });
        await AssertProblem(r, HttpStatusCode.Conflict, "/domain-rule");
    }

    [Fact]
    public async Task Full_workflow_produces_a_verifiable_evidence_bundle()
    {
        var reference = await OpenCase("ALR-2026-000700");
        var analyst = As("analyst", "analyst");
        var officer = As("officer.saps", "field_officer");

        Assert.True((await analyst.PostAsJsonAsync($"/api/cases/{reference}/transitions", new { to = "Assigned", assignTo = "officer.saps" })).IsSuccessStatusCode);
        Assert.True((await officer.PostAsJsonAsync($"/api/cases/{reference}/transitions", new { to = "OnScene", note = "Arrived at collar 23:41" })).IsSuccessStatusCode);

        var digest = HashChain.Sha256Hex("photo-of-fresh-spoil.jpg-bytes");
        var added = await officer.PostAsJsonAsync($"/api/cases/{reference}/evidence", new { kind = "Photograph", sha256 = digest, description = "Fresh spoil at collar" });
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        var evidenceId = (await added.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("id").GetGuid();

        // Only the current holder can hand evidence over.
        var stolen = await analyst.PostAsJsonAsync($"/api/evidence/{evidenceId}/custody", new { to = "analyst", reason = "grab" });
        await AssertProblem(stolen, HttpStatusCode.Conflict, "/domain-rule");
        Assert.True((await officer.PostAsJsonAsync($"/api/evidence/{evidenceId}/custody", new { to = "lab.tech", reason = "forensics" })).IsSuccessStatusCode);

        var verify = await (await analyst.GetAsync($"/api/evidence/{evidenceId}/custody/verify")).Content.ReadFromJsonAsync<CustodyCheck>(Json);
        Assert.True(verify!.Intact);
        Assert.Equal(2, verify.Links);

        Assert.True((await officer.PostAsJsonAsync($"/api/cases/{reference}/transitions", new { to = "EvidenceSecured" })).IsSuccessStatusCode);
        Assert.True((await analyst.PostAsJsonAsync($"/api/cases/{reference}/transitions", new { to = "ReferredToNpa" })).IsSuccessStatusCode);

        var bundle = await (await analyst.GetAsync($"/api/cases/{reference}/bundle")).Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.Equal(64, bundle.GetProperty("manifestSha256").GetString()!.Length);
        Assert.Equal(2, bundle.GetProperty("items").GetArrayLength());
        Assert.All(bundle.GetProperty("items").EnumerateArray(), i => Assert.True(i.GetProperty("custodyIntact").GetBoolean()));
    }

    private sealed record CustodyCheck(Guid EvidenceId, bool Intact, int? FirstBrokenLink, int Links);
}
