using System.Text.RegularExpressions;
using Sentinel.Cases.Domain;

namespace Sentinel.Cases.Api;

/// <summary>Outbox event body posted by the Python API when an alert is dispatched.</summary>
public sealed record OpenCaseRequest(
    string AlertRef,
    string MineId,
    string Level,
    double Posterior,
    string Reason,
    DateTimeOffset RaisedAt,
    string Signature,
    string RequestedBy);

public sealed record TransitionRequest(string To, string? Note, string? AssignTo);

public sealed record AddEvidenceRequest(string Kind, string Sha256, string Description);

public sealed record CustodyRequest(string To, string Reason);

public sealed record CaseSummary(string Reference, string AlertRef, string MineId, string Status, string Priority,
                                 double Posterior, string? AssignedTo, DateTimeOffset OpenedAt, DateTimeOffset? ClosedAt);

public sealed record EvidenceView(Guid Id, string Kind, string Sha256, string Description, string CurrentHolder,
                                  int CustodyLinks, bool CustodyIntact);

public sealed record CaseDetail(CaseSummary Case, IReadOnlyList<EvidenceView> Evidence,
                                IReadOnlyList<TimelineEntry> Timeline);

public sealed record TimelineEntry(DateTimeOffset At, string Actor, string Action, string? Note);

public sealed record CustodyVerification(Guid EvidenceId, bool Intact, int? FirstBrokenLink, int Links);

/// <summary>
/// Manual, explicit validation (no reflection magic): every rule produces a field-keyed message
/// that becomes the ProblemDetails "errors" map.
/// </summary>
public static partial class Validate
{
    [GeneratedRegex("^ALR-\\d{4}-\\d{6}$")]
    private static partial Regex AlertRefPattern();

    [GeneratedRegex("^ZA-[A-Z]{2,3}-\\d{3}$")]
    private static partial Regex MineIdPattern();

    public static void Open(OpenCaseRequest r)
    {
        var e = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(r.AlertRef) || !AlertRefPattern().IsMatch(r.AlertRef))
        {
            e["alertRef"] = ["Must look like ALR-2026-000123."];
        }

        if (string.IsNullOrWhiteSpace(r.MineId) || !MineIdPattern().IsMatch(r.MineId))
        {
            e["mineId"] = ["Must be a register id such as ZA-NW-002."];
        }

        if (r.Posterior is < 0 or > 1)
        {
            e["posterior"] = ["Must be between 0 and 1."];
        }

        if (r.Level is not ("high" or "critical"))
        {
            e["level"] = ["Must be 'high' or 'critical'."];
        }

        if (string.IsNullOrWhiteSpace(r.Signature) || r.Signature.Length != 128)
        {
            e["signature"] = ["Must be a 64-byte Ed25519 signature in hex."];
        }

        Throw(e);
    }

    public static CaseStatus Transition(TransitionRequest r)
    {
        if (!Enum.TryParse<CaseStatus>(r.To, ignoreCase: true, out var to))
        {
            Throw(new() { ["to"] = [$"Unknown status. Allowed: {string.Join(", ", Enum.GetNames<CaseStatus>())}."] });
        }

        if (to == CaseStatus.Assigned && string.IsNullOrWhiteSpace(r.AssignTo))
        {
            Throw(new() { ["assignTo"] = ["Required when assigning a case."] });
        }

        return to;
    }

    public static EvidenceKind Evidence(AddEvidenceRequest r)
    {
        var e = new Dictionary<string, string[]>();
        if (!Enum.TryParse<EvidenceKind>(r.Kind, ignoreCase: true, out var kind))
        {
            e["kind"] = [$"Allowed: {string.Join(", ", Enum.GetNames<EvidenceKind>())}."];
        }

        if (!EvidenceItem.IsSha256(r.Sha256 ?? string.Empty))
        {
            e["sha256"] = ["Lowercase hex SHA-256 (64 characters) of the evidence bytes."];
        }

        if (string.IsNullOrWhiteSpace(r.Description) || r.Description.Length > 500)
        {
            e["description"] = ["Required, at most 500 characters."];
        }

        Throw(e);
        return kind;
    }

    private static void Throw(Dictionary<string, string[]> errors)
    {
        if (errors.Count > 0)
        {
            throw new RequestValidationException(errors);
        }
    }
}
