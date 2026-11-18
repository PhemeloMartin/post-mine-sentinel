using Microsoft.EntityFrameworkCore;
using Sentinel.Cases.Domain;

namespace Sentinel.Cases.Api.Data;

/// <summary>EF Core mapping. PostgreSQL in deployed environments (Npgsql), SQLite in tests.</summary>
public sealed class CasesDbContext(DbContextOptions<CasesDbContext> options) : DbContext(options)
{
    public DbSet<IncidentCase> Cases => Set<IncidentCase>();
    public DbSet<EvidenceItem> Evidence => Set<EvidenceItem>();
    public DbSet<CustodyTransfer> Custody => Set<CustodyTransfer>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<IncidentCase>(e =>
        {
            e.ToTable("cases");
            e.HasKey(x => x.Id);
            // Keys are generated in the domain (Guid.NewGuid()), not by the database. Without this,
            // EF treats key-set entities discovered via navigations as existing rows (UPDATE → 0 rows).
            e.Property(x => x.Id).ValueGeneratedNever();
            e.HasIndex(x => x.Reference).IsUnique();
            e.HasIndex(x => x.IdempotencyKey).IsUnique();          // at-most-once case per outbox event
            e.HasIndex(x => new { x.Status, x.OpenedAt });
            e.Property(x => x.Reference).HasMaxLength(32);
            e.Property(x => x.AlertRef).HasMaxLength(32);
            e.Property(x => x.MineId).HasMaxLength(16);
            e.Property(x => x.IdempotencyKey).HasMaxLength(80);
            e.Property(x => x.Reason).HasMaxLength(255);
            e.Property(x => x.AlertSignature).HasMaxLength(128);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(24);
            e.Property(x => x.Priority).HasConversion<string>().HasMaxLength(12);
            e.Property(x => x.Version).IsConcurrencyToken();      // optimistic concurrency (409 on conflict)
            e.HasMany(x => x.Timeline).WithOne().HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Evidence).WithOne().HasForeignKey(x => x.CaseId).OnDelete(DeleteBehavior.Restrict);
            e.Navigation(x => x.Timeline).UsePropertyAccessMode(PropertyAccessMode.Field);
            e.Navigation(x => x.Evidence).UsePropertyAccessMode(PropertyAccessMode.Field);
        });

        b.Entity<CaseEvent>(e =>
        {
            e.ToTable("case_events");
            e.HasKey(x => x.Id);
            e.Property(x => x.Action).HasMaxLength(48);
            e.Property(x => x.Actor).HasMaxLength(64);
        });

        b.Entity<EvidenceItem>(e =>
        {
            e.ToTable("evidence");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(24);
            e.Property(x => x.Sha256).HasMaxLength(64).IsFixedLength();
            e.Ignore(x => x.CurrentHolder);
            e.HasMany(x => x.Custody).WithOne().HasForeignKey(x => x.EvidenceId).OnDelete(DeleteBehavior.Restrict);
            e.Navigation(x => x.Custody).UsePropertyAccessMode(PropertyAccessMode.Field);
        });

        b.Entity<CustodyTransfer>(e =>
        {
            e.ToTable("custody_transfers");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.EvidenceId, x.Sequence }).IsUnique();
            e.Property(x => x.Hash).HasMaxLength(64).IsFixedLength();
            e.Property(x => x.PreviousHash).HasMaxLength(64).IsFixedLength();
        });
    }

    /// <summary>Bumps the concurrency token on every modified case so concurrent edits conflict.</summary>
    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        foreach (var entry in ChangeTracker.Entries<IncidentCase>().Where(e => e.State == EntityState.Modified))
        {
            entry.Property(x => x.Version).CurrentValue = entry.Entity.Version + 1;
        }

        return base.SaveChangesAsync(cancellationToken);
    }
}
