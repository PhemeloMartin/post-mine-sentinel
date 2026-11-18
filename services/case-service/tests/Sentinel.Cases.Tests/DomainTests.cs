using Sentinel.Cases.Domain;

namespace Sentinel.Cases.Tests;

public class DomainTests
{
    private static readonly DateTimeOffset T0 = new(2026, 11, 18, 21, 5, 0, TimeSpan.FromHours(2));
    private static readonly string Sig = new('a', 128);
    private static readonly string Digest = HashChain.Sha256Hex("sensor-window-bytes");

    private static IncidentCase NewCase() =>
        IncidentCase.Open("CASE-2026-000001", "ALR-2026-000001", "ZA-NW-002", "critical", 0.98, "footsteps", Sig, "k1", "analyst", T0);

    [Fact]
    public void Opening_a_case_seeds_the_signed_alert_as_first_evidence()
    {
        var c = NewCase();
        Assert.Equal(CaseStatus.Opened, c.Status);
        Assert.Equal(CasePriority.Critical, c.Priority);
        var first = Assert.Single(c.Evidence);
        Assert.Equal(EvidenceKind.AlertSignature, first.Kind);
        Assert.Null(first.VerifyCustody());
    }

    [Fact]
    public void Happy_path_follows_the_state_machine()
    {
        var c = NewCase();
        c.Assign("officer.saps", "analyst", T0.AddMinutes(1));
        c.TransitionTo(CaseStatus.OnScene, "officer.saps", "arrived", T0.AddMinutes(20));
        c.AddEvidence(EvidenceKind.Photograph, Digest, "Fresh spoil at collar", "officer.saps", T0.AddMinutes(25));
        c.TransitionTo(CaseStatus.EvidenceSecured, "officer.saps", null, T0.AddMinutes(30));
        c.TransitionTo(CaseStatus.ReferredToNpa, "analyst", null, T0.AddHours(3));
        c.TransitionTo(CaseStatus.Closed, "analyst", null, T0.AddDays(2));
        Assert.Equal(CaseStatus.Closed, c.Status);
        Assert.NotNull(c.ClosedAt);
        Assert.Equal(7, c.Timeline.Count);
    }

    [Theory]
    [InlineData(CaseStatus.OnScene)]
    [InlineData(CaseStatus.ReferredToNpa)]
    [InlineData(CaseStatus.Closed)]
    public void Illegal_transitions_from_opened_are_rejected(CaseStatus target)
    {
        var c = NewCase();
        Assert.Throws<DomainRuleException>(() => c.TransitionTo(target, "analyst", null, T0));
    }

    [Fact]
    public void Referral_requires_field_evidence()
    {
        var c = NewCase();
        c.Assign("officer", "analyst", T0);
        c.TransitionTo(CaseStatus.OnScene, "officer", null, T0);
        // Only the system-generated alert evidence exists; referral must be blocked.
        Assert.Throws<DomainRuleException>(() => c.TransitionTo(CaseStatus.ReferredToNpa, "analyst", null, T0));
    }

    [Fact]
    public void Evidence_cannot_be_added_to_a_closed_case()
    {
        var c = NewCase();
        c.TransitionTo(CaseStatus.Cancelled, "analyst", "duplicate", T0);
        Assert.Throws<DomainRuleException>(() => c.AddEvidence(EvidenceKind.Statement, Digest, "late", "x", T0));
    }

    [Fact]
    public void Custody_chain_verifies_and_only_the_holder_can_hand_over()
    {
        var item = EvidenceItem.Collect(Guid.NewGuid(), EvidenceKind.SensorWindow, Digest, "S05 window", "officer.a", T0);
        item.TransferTo("lab.tech", "forensic analysis", "officer.a", T0.AddHours(1));
        item.TransferTo("evidence.store", "storage", "lab.tech", T0.AddHours(5));
        Assert.Equal(3, item.Custody.Count);
        Assert.Equal("evidence.store", item.CurrentHolder);
        Assert.Null(item.VerifyCustody());
        Assert.Throws<DomainRuleException>(() => item.TransferTo("someone", "x", "officer.a", T0.AddHours(6)));
    }

    [Fact]
    public void Rewriting_custody_history_is_detected()
    {
        var item = EvidenceItem.Collect(Guid.NewGuid(), EvidenceKind.SensorWindow, Digest, "S05 window", "officer.a", T0);
        item.TransferTo("lab.tech", "analysis", "officer.a", T0.AddHours(1));
        item.TransferTo("store", "storage", "lab.tech", T0.AddHours(2));
        // Insider edits link #2 directly in the database (simulated with reflection).
        typeof(CustodyTransfer).GetProperty(nameof(CustodyTransfer.ToHolder))!.SetValue(item.Custody[1], "mallory");
        Assert.Equal(2, item.VerifyCustody());
    }

    [Theory]
    [InlineData("ABC")]
    [InlineData("G000000000000000000000000000000000000000000000000000000000000000")]
    public void Digests_must_be_lowercase_sha256(string bad) =>
        Assert.Throws<DomainRuleException>(() => EvidenceItem.Collect(Guid.NewGuid(), EvidenceKind.Photograph, bad, "x", "y", T0));
}
