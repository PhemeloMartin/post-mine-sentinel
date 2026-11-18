using System.Globalization;
using System.Text.RegularExpressions;

namespace Sentinel.Cases.Domain;

public enum EvidenceKind
{
    AlertSignature,
    SensorWindow,
    SatelliteScene,
    InspectionReport,
    Photograph,
    Statement,
}

/// <summary>
/// A piece of evidence identified by its SHA-256 digest (the bytes live in WORM object storage).
/// Every hand-over is appended to a per-item custody chain so the integrity of the
/// chain of custody can be demonstrated in court (Criminal Procedure Act s212, ECTA s15).
/// </summary>
public sealed partial class EvidenceItem
{
    private readonly List<CustodyTransfer> _custody = [];

    private EvidenceItem() { }

    public Guid Id { get; private set; }
    public Guid CaseId { get; private set; }
    public EvidenceKind Kind { get; private set; }
    public string Sha256 { get; private set; } = string.Empty;
    public string Description { get; private set; } = string.Empty;
    public string CollectedBy { get; private set; } = string.Empty;
    public DateTimeOffset CollectedAt { get; private set; }

    public IReadOnlyList<CustodyTransfer> Custody => _custody;

    public string CurrentHolder => _custody.Count == 0 ? CollectedBy : _custody[^1].ToHolder;

    [GeneratedRegex("^[0-9a-f]{64}$")]
    private static partial Regex Sha256Pattern();

    public static bool IsSha256(string value) => Sha256Pattern().IsMatch(value);

    public static EvidenceItem Collect(Guid caseId, EvidenceKind kind, string sha256, string description, string collectedBy,
                                       DateTimeOffset now)
    {
        if (!IsSha256(sha256))
        {
            throw new DomainRuleException("Evidence digest must be a lowercase hex SHA-256 (64 characters).");
        }

        var item = new EvidenceItem
        {
            Id = Guid.NewGuid(),
            CaseId = caseId,
            Kind = kind,
            Sha256 = sha256,
            Description = description,
            CollectedBy = collectedBy,
            CollectedAt = now,
        };
        var origin = CustodyTransfer.Create(item.Id, 1, HashChain.Genesis, "(source)", collectedBy, "collected", now);
        origin.Seal(sha256);
        item._custody.Add(origin);
        return item;
    }

    public CustodyTransfer TransferTo(string toHolder, string reason, string actor, DateTimeOffset now)
    {
        if (!string.Equals(actor, CurrentHolder, StringComparison.Ordinal))
        {
            throw new DomainRuleException($"Only the current holder ({CurrentHolder}) can hand over evidence {Id}.");
        }

        if (string.Equals(toHolder, CurrentHolder, StringComparison.Ordinal))
        {
            throw new DomainRuleException("Evidence is already held by that person.");
        }

        var last = _custody[^1];
        var t = CustodyTransfer.Create(Id, last.Sequence + 1, last.Hash, CurrentHolder, toHolder, reason, now);
        t.Seal(Sha256);
        _custody.Add(t);
        return t;
    }

    /// <summary>Returns the sequence number of the first broken link, or null when intact.</summary>
    public int? VerifyCustody()
    {
        var prev = HashChain.Genesis;
        foreach (var t in _custody.OrderBy(c => c.Sequence))
        {
            if (t.PreviousHash != prev || t.Hash != HashChain.Link(prev, t.Canonical(Sha256)))
            {
                return t.Sequence;
            }

            prev = t.Hash;
        }

        return null;
    }
}

public sealed class CustodyTransfer
{
    private CustodyTransfer() { }

    public long Id { get; private set; }
    public Guid EvidenceId { get; private set; }
    public int Sequence { get; private set; }
    public string FromHolder { get; private set; } = string.Empty;
    public string ToHolder { get; private set; } = string.Empty;
    public string Reason { get; private set; } = string.Empty;
    public DateTimeOffset At { get; private set; }
    public string PreviousHash { get; private set; } = string.Empty;
    public string Hash { get; private set; } = string.Empty;

    /// <summary>Canonical text that is hashed; includes the evidence digest so items cannot be swapped.</summary>
    public string Canonical(string evidenceSha256) => string.Join('|', Sequence.ToString(CultureInfo.InvariantCulture),
        evidenceSha256, FromHolder, ToHolder, Reason, At.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));

    internal static CustodyTransfer Create(Guid evidenceId, int sequence, string previousHash, string from, string to,
                                           string reason, DateTimeOffset at)
    {
        var t = new CustodyTransfer
        {
            EvidenceId = evidenceId,
            Sequence = sequence,
            FromHolder = from,
            ToHolder = to,
            Reason = reason,
            At = at,
            PreviousHash = previousHash,
        };
        return t;
    }

    internal void Seal(string evidenceSha256) => Hash = HashChain.Link(PreviousHash, Canonical(evidenceSha256));
}
