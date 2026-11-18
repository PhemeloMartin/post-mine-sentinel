using System.Globalization;

namespace Sentinel.Cases.Domain;

public enum CaseStatus
{
    Opened,
    Assigned,
    OnScene,
    EvidenceSecured,
    ReferredToNpa,
    Closed,
    Cancelled,
}

public enum CasePriority
{
    High,
    Critical,
}

/// <summary>
/// Incident case opened when an alert is dispatched. The lifecycle is an explicit state machine
/// so that a case can never, for example, be referred to the prosecuting authority before
/// evidence has been secured.
/// </summary>
public sealed class IncidentCase
{
    private static readonly Dictionary<CaseStatus, CaseStatus[]> Allowed = new()
    {
        [CaseStatus.Opened] = [CaseStatus.Assigned, CaseStatus.Cancelled],
        [CaseStatus.Assigned] = [CaseStatus.OnScene, CaseStatus.Cancelled],
        [CaseStatus.OnScene] = [CaseStatus.EvidenceSecured, CaseStatus.Closed],
        [CaseStatus.EvidenceSecured] = [CaseStatus.ReferredToNpa, CaseStatus.Closed],
        [CaseStatus.ReferredToNpa] = [CaseStatus.Closed],
        [CaseStatus.Closed] = [],
        [CaseStatus.Cancelled] = [],
    };

    private readonly List<CaseEvent> _timeline = [];
    private readonly List<EvidenceItem> _evidence = [];

    private IncidentCase() { } // EF Core

    public Guid Id { get; private set; }
    public string Reference { get; private set; } = string.Empty;
    public string AlertRef { get; private set; } = string.Empty;
    public string MineId { get; private set; } = string.Empty;
    public string IdempotencyKey { get; private set; } = string.Empty;
    public CasePriority Priority { get; private set; }
    public CaseStatus Status { get; private set; }
    public string? AssignedTo { get; private set; }
    public double Posterior { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public string AlertSignature { get; private set; } = string.Empty;
    public DateTimeOffset OpenedAt { get; private set; }
    public DateTimeOffset? ClosedAt { get; private set; }
    public uint Version { get; private set; } // optimistic concurrency token

    public IReadOnlyList<CaseEvent> Timeline => _timeline;
    public IReadOnlyList<EvidenceItem> Evidence => _evidence;

    public static readonly IReadOnlyCollection<CaseStatus> Terminal = [CaseStatus.Closed, CaseStatus.Cancelled];

    public static IncidentCase Open(string reference, string alertRef, string mineId, string level, double posterior,
                            string reason, string alertSignature, string idempotencyKey, string requestedBy,
                            DateTimeOffset now)
    {
        if (posterior is < 0 or > 1)
        {
            throw new DomainRuleException("Posterior must be a probability in [0, 1].");
        }

        var c = new IncidentCase
        {
            Id = Guid.NewGuid(),
            Reference = reference,
            AlertRef = alertRef,
            MineId = mineId,
            Priority = string.Equals(level, "critical", StringComparison.OrdinalIgnoreCase) ? CasePriority.Critical : CasePriority.High,
            Status = CaseStatus.Opened,
            Posterior = posterior,
            Reason = reason,
            AlertSignature = alertSignature,
            IdempotencyKey = idempotencyKey,
            OpenedAt = now,
        };
        c._timeline.Add(new CaseEvent(c.Id, now, requestedBy, "opened",
            string.Create(CultureInfo.InvariantCulture, $"Opened from {alertRef} (P = {posterior:P1})")));
        // The signed alert itself is the first evidence item of every case.
        c._evidence.Add(EvidenceItem.Collect(c.Id, EvidenceKind.AlertSignature, HashChain.Sha256Hex(alertSignature),
            $"Ed25519-signed alert {alertRef}", "sentinel-api", now));
        return c;
    }

    public void Assign(string officer, string actor, DateTimeOffset now)
    {
        TransitionTo(CaseStatus.Assigned, actor, $"Assigned to {officer}", now);
        AssignedTo = officer;
    }

    public void TransitionTo(CaseStatus next, string actor, string? note, DateTimeOffset now)
    {
        if (!Allowed[Status].Contains(next))
        {
            throw new DomainRuleException($"Cannot move case {Reference} from {Status} to {next}.");
        }

        if (next == CaseStatus.ReferredToNpa && _evidence.Count < 2)
        {
            throw new DomainRuleException("At least one field evidence item is required before referral to the NPA.");
        }

        Status = next;
        if (Terminal.Contains(next))
        {
            ClosedAt = now;
        }

        _timeline.Add(new CaseEvent(Id, now, actor, $"status:{next}", note));
    }

    public EvidenceItem AddEvidence(EvidenceKind kind, string sha256, string description, string actor, DateTimeOffset now)
    {
        if (Terminal.Contains(Status))
        {
            throw new DomainRuleException($"Case {Reference} is {Status}; evidence can no longer be added.");
        }

        var item = EvidenceItem.Collect(Id, kind, sha256, description, actor, now);
        _evidence.Add(item);
        _timeline.Add(new CaseEvent(Id, now, actor, "evidence:added", $"{kind} {sha256[..12]}…"));
        return item;
    }
}

public sealed class CaseEvent
{
    private CaseEvent() { }

    public CaseEvent(Guid caseId, DateTimeOffset at, string actor, string action, string? note)
    {
        CaseId = caseId;
        At = at;
        Actor = actor;
        Action = action;
        Note = note;
    }

    public long Id { get; private set; }
    public Guid CaseId { get; private set; }
    public DateTimeOffset At { get; private set; }
    public string Actor { get; private set; } = string.Empty;
    public string Action { get; private set; } = string.Empty;
    public string? Note { get; private set; }
}
