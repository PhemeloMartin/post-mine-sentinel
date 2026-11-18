using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Sentinel.Cases.Api.Data;
using Sentinel.Cases.Domain;

namespace Sentinel.Cases.Api.Endpoints;

public sealed class ServiceAuthOptions
{
    public string Token { get; set; } = string.Empty;
}

public static class CaseEndpoints
{
    public const string ReadPolicy = "cases:read";
    public const string WritePolicy = "cases:write";

    public static RouteGroupBuilder MapCaseEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api").WithTags("cases");

        // Service-to-service: the Python API's outbox relay opens cases (idempotent).
        api.MapPost("/cases", OpenCase).AddEndpointFilter(ServiceTokenFilter).AllowAnonymous();

        api.MapGet("/cases", ListCases).RequireAuthorization(ReadPolicy);
        api.MapGet("/cases/{reference}", GetCase).RequireAuthorization(ReadPolicy);
        api.MapGet("/cases/{reference}/bundle", EvidenceBundle).RequireAuthorization(ReadPolicy);
        api.MapPost("/cases/{reference}/transitions", Transition).RequireAuthorization(WritePolicy);
        api.MapPost("/cases/{reference}/evidence", AddEvidence).RequireAuthorization(WritePolicy);
        api.MapPost("/evidence/{id:guid}/custody", TransferCustody).RequireAuthorization(WritePolicy);
        api.MapGet("/evidence/{id:guid}/custody/verify", VerifyCustody).RequireAuthorization(ReadPolicy);
        return api;
    }

    private static async ValueTask<object?> ServiceTokenFilter(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var expected = ctx.HttpContext.RequestServices.GetRequiredService<IOptions<ServiceAuthOptions>>().Value.Token;
        var presented = ctx.HttpContext.Request.Headers["X-Service-Token"].ToString();
        var ok = expected.Length > 0 && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(presented), Encoding.UTF8.GetBytes(expected));
        return ok
            ? await next(ctx)
            : Results.Problem(statusCode: 401, title: "Invalid service credentials", type: "https://sentinel.example.org/problems/unauthorized");
    }

    private static string Actor(ClaimsPrincipal user) => user.FindFirstValue("sub") ?? "unknown";

    private static async Task<IResult> OpenCase(OpenCaseRequest body, HttpRequest request, CasesDbContext db, TimeProvider clock, CancellationToken ct)
    {
        Validate.Open(body);
        var key = request.Headers["Idempotency-Key"].ToString();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 80)
        {
            throw new RequestValidationException(new Dictionary<string, string[]> { ["Idempotency-Key"] = ["Header required (≤ 80 chars)."] });
        }

        // Replays of the same outbox event return the existing case (at-most-once semantics).
        var existing = await db.Cases.AsNoTracking().FirstOrDefaultAsync(c => c.IdempotencyKey == key, ct);
        if (existing is not null)
        {
            return Results.Ok(Summary(existing));
        }

        var now = clock.GetUtcNow();
        var count = await db.Cases.CountAsync(ct);
        var reference = string.Create(CultureInfo.InvariantCulture, $"CASE-{now.Year}-{count + 1:000000}");
        var c = IncidentCase.Open(reference, body.AlertRef, body.MineId, body.Level, body.Posterior, body.Reason,
            body.Signature, key, body.RequestedBy, now);
        db.Cases.Add(c);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/cases/{reference}", Summary(c));
    }

    private static async Task<IResult> ListCases(CasesDbContext db, string? status, int? page, CancellationToken ct)
    {
        var p = Math.Max(1, page ?? 1);
        var q = db.Cases.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Enum.TryParse<CaseStatus>(status, true, out var s))
            {
                throw new RequestValidationException(new Dictionary<string, string[]> { ["status"] = ["Unknown status."] });
            }

            q = q.Where(c => c.Status == s);
        }

        var items = (await q.ToListAsync(ct)).OrderByDescending(c => c.OpenedAt).Skip((p - 1) * 50).Take(50).Select(Summary).ToList();
        return Results.Ok(new { page = p, items });
    }

    private static async Task<IncidentCase> Load(CasesDbContext db, string reference, CancellationToken ct) =>
        await db.Cases.Include(c => c.Timeline).Include(c => c.Evidence).ThenInclude(e => e.Custody)
            .AsSplitQuery()
            .FirstOrDefaultAsync(c => c.Reference == reference, ct)
        ?? throw new NotFoundException($"Case {reference} not found.");

    private static async Task<IResult> GetCase(string reference, CasesDbContext db, CancellationToken ct) =>
        Results.Ok(Detail(await Load(db, reference, ct)));

    private static async Task<IResult> Transition(string reference, TransitionRequest body, ClaimsPrincipal user,
                                                  CasesDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var to = Validate.Transition(body);
        var c = await Load(db, reference, ct);
        if (to == CaseStatus.Assigned)
        {
            c.Assign(body.AssignTo!, Actor(user), clock.GetUtcNow());
        }
        else
        {
            c.TransitionTo(to, Actor(user), body.Note, clock.GetUtcNow());
        }

        await db.SaveChangesAsync(ct);
        return Results.Ok(Detail(c));
    }

    private static async Task<IResult> AddEvidence(string reference, AddEvidenceRequest body, ClaimsPrincipal user,
                                                   CasesDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var kind = Validate.Evidence(body);
        var c = await Load(db, reference, ct);
        var item = c.AddEvidence(kind, body.Sha256, body.Description, Actor(user), clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/evidence/{item.Id}", ToView(item));
    }

    private static async Task<IResult> TransferCustody(Guid id, CustodyRequest body, ClaimsPrincipal user, CasesDbContext db,
                                                       TimeProvider clock, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.To) || string.IsNullOrWhiteSpace(body.Reason))
        {
            throw new RequestValidationException(new Dictionary<string, string[]>
            {
                ["to"] = ["Recipient required."],
                ["reason"] = ["Reason required."],
            });
        }

        var item = await db.Evidence.Include(e => e.Custody).FirstOrDefaultAsync(e => e.Id == id, ct)
                   ?? throw new NotFoundException($"Evidence {id} not found.");
        item.TransferTo(body.To, body.Reason, Actor(user), clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return Results.Ok(ToView(item));
    }

    private static async Task<IResult> VerifyCustody(Guid id, CasesDbContext db, CancellationToken ct)
    {
        var item = await db.Evidence.AsNoTracking().Include(e => e.Custody).FirstOrDefaultAsync(e => e.Id == id, ct)
                   ?? throw new NotFoundException($"Evidence {id} not found.");
        var broken = item.VerifyCustody();
        return Results.Ok(new CustodyVerification(item.Id, broken is null, broken, item.Custody.Count));
    }

    /// <summary>Court-ready manifest: every evidence digest with its full custody chain and verdict.</summary>
    private static async Task<IResult> EvidenceBundle(string reference, CasesDbContext db, CancellationToken ct)
    {
        var c = await Load(db, reference, ct);
        var items = c.Evidence.Select(e => new
        {
            e.Id,
            Kind = e.Kind.ToString(),
            e.Sha256,
            e.Description,
            e.CollectedBy,
            e.CollectedAt,
            CustodyIntact = e.VerifyCustody() is null,
            Custody = e.Custody.OrderBy(t => t.Sequence).Select(t => new { t.Sequence, t.FromHolder, t.ToHolder, t.Reason, t.At, t.PreviousHash, t.Hash }),
        }).ToList();
        var manifestHash = HashChain.Sha256Hex(string.Join('|', items.Select(i => i.Sha256 + ":" + i.Custody.Last().Hash)));
        return Results.Ok(new
        {
            Case = Summary(c),
            c.AlertSignature,
            Items = items,
            ManifestSha256 = manifestHash,
            Statement = "Prepared for affidavit under s212 of the Criminal Procedure Act 51 of 1977; data messages per ECTA s15.",
        });
    }

    private static CaseSummary Summary(IncidentCase c) => new(c.Reference, c.AlertRef, c.MineId, c.Status.ToString(),
        c.Priority.ToString(), c.Posterior, c.AssignedTo, c.OpenedAt, c.ClosedAt);

    private static EvidenceView ToView(EvidenceItem e) =>
        new(e.Id, e.Kind.ToString(), e.Sha256, e.Description, e.CurrentHolder, e.Custody.Count, e.VerifyCustody() is null);

    private static CaseDetail Detail(IncidentCase c) => new(Summary(c), [.. c.Evidence.Select(ToView)],
        [.. c.Timeline.OrderBy(t => t.At).Select(t => new TimelineEntry(t.At, t.Actor, t.Action, t.Note))]);
}
