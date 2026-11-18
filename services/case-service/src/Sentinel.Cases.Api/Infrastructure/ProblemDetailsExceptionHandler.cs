using System.Diagnostics;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Sentinel.Cases.Domain;

namespace Sentinel.Cases.Api.Infrastructure;

/// <summary>
/// Single place where exceptions become HTTP responses (RFC 7807 Problem Details).
/// Expected failures map to precise 4xx codes; anything else is logged with the trace id and
/// returned as a generic 500 so internals (stack traces, SQL) never leak to clients.
/// </summary>
public sealed partial class ProblemDetailsExceptionHandler(
    IProblemDetailsService problemDetails,
    ILogger<ProblemDetailsExceptionHandler> logger) : IExceptionHandler
{
    private const string Base = "https://sentinel.example.org/problems/";

    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception exception, CancellationToken cancellationToken)
    {
        var (status, slug, title, detail) = exception switch
        {
            RequestValidationException => (StatusCodes.Status400BadRequest, "validation", "Request validation failed", null),
            NotFoundException nf => (StatusCodes.Status404NotFound, "not-found", "Resource not found", nf.Message),
            DomainRuleException dr => (StatusCodes.Status409Conflict, "domain-rule", "Business rule violated", dr.Message),
            DbUpdateConcurrencyException => (StatusCodes.Status409Conflict, "concurrency",
                "The case was changed by someone else", "Reload the case and try again."),
            DbUpdateException => (StatusCodes.Status409Conflict, "conflict", "Conflict with existing data", null),
            BadHttpRequestException bad => (bad.StatusCode, "bad-request", "Malformed request", "The request body could not be read."),
            OperationCanceledException => (499, "cancelled", "Request cancelled", null),
            _ => (StatusCodes.Status500InternalServerError, "internal", "Internal server error",
                "An unexpected error occurred. Quote the traceId when contacting support."),
        };

        var traceId = Activity.Current?.TraceId.ToString() ?? http.TraceIdentifier;
        if (status >= 500)
        {
            LogUnhandled(logger, exception, traceId);
        }

        var pd = new ProblemDetails
        {
            Type = Base + slug,
            Title = title,
            Status = status,
            Detail = detail,
            Instance = http.Request.Path,
        };
        pd.Extensions["traceId"] = traceId;
        if (exception is RequestValidationException v)
        {
            pd.Extensions["errors"] = v.Errors;
        }

        http.Response.StatusCode = status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext { HttpContext = http, ProblemDetails = pd, Exception = exception });
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Unhandled exception (traceId {TraceId})")]
    private static partial void LogUnhandled(ILogger logger, Exception exception, string traceId);
}
