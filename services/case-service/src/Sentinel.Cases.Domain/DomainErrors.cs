namespace Sentinel.Cases.Domain;

/// <summary>A business rule was violated (maps to HTTP 409 Conflict).</summary>
public sealed class DomainRuleException(string message) : Exception(message);

/// <summary>An aggregate or entity does not exist (maps to HTTP 404).</summary>
public sealed class NotFoundException(string message) : Exception(message);

/// <summary>Input failed validation (maps to HTTP 400 with a field → messages map).</summary>
public sealed class RequestValidationException(IDictionary<string, string[]> errors)
    : Exception("One or more validation errors occurred.")
{
    public IDictionary<string, string[]> Errors { get; } = errors;
}
