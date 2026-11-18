// Mirrors ml/sentinel_ml/features/seismic.py step by step. Precision choices follow the Python
// reference: x is float32; moments, FFT, cumulative sums and autocorrelation run in double; the
// envelope and its median/MAD statistics are float32 (NumPy 2 / NEP 50 promotion rules).
#include "sentinel/features.hpp"

#include <algorithm>
#include <cmath>

#include "sentinel/fft.hpp"

namespace sentinel {
namespace {

constexpr std::size_t N = kWindow;
constexpr std::size_t kNfft = 2048;
constexpr std::size_t kBins = kNfft / 2;  // k = 1..1024
constexpr int kEnvWin = 25;
constexpr int kDecim = 5;
constexpr int kM = static_cast<int>(N) / kDecim;  // 400
constexpr int kLagMin = 17;
constexpr int kLagMax = 200;
constexpr int kSta = 50;
constexpr int kLta = 500;
constexpr int kMinSep = 15;
constexpr double kFs = 500.0;
constexpr double kNyq = kFs / 2.0;
constexpr double kEdges[7] = {1.0, 8.0, 16.0, 32.0, 64.0, 128.0, 250.0};
constexpr double kPi = 3.14159265358979323846;

float hann(std::size_t i) {
    return static_cast<float>(0.5 - 0.5 * std::cos(2.0 * kPi * static_cast<double>(i) / static_cast<double>(N - 1)));
}

/// Median exactly like the Python helper: sort, average the two middle values (float32 maths).
float median(const float* v, int n, float* scratch) {
    std::copy(v, v + n, scratch);
    std::sort(scratch, scratch + n);
    if (n % 2 == 0) return 0.5f * (scratch[n / 2 - 1] + scratch[n / 2]);
    return scratch[n / 2];
}

}  // namespace

Status extractFeatures(const int16_t* s, std::size_t n, FeatureVector& out, FeatureWorkspace& ws) {
    if (s == nullptr) return Status::InvalidArgument;
    if (n != N) return Status::BufferTooSmall;

    // ---- de-mean -----------------------------------------------------------------------
    double sum = 0.0;
    for (std::size_t i = 0; i < N; ++i) sum += static_cast<double>(s[i]);
    const double mean = sum / static_cast<double>(N);
    for (std::size_t i = 0; i < N; ++i) ws.x[i] = static_cast<float>(static_cast<double>(s[i]) - mean);

    // ---- time domain ---------------------------------------------------------------------
    double m2 = 0.0, m4 = 0.0, peak = 0.0;
    int zc = 0;
    for (std::size_t i = 0; i < N; ++i) {
        const double v = ws.x[i];
        const double v2 = v * v;
        m2 += v2;
        m4 += v2 * v2;
        peak = std::max(peak, std::fabs(v));
        if (i > 0 && static_cast<double>(ws.x[i - 1]) * v < 0.0) ++zc;
    }
    m2 /= static_cast<double>(N);
    m4 /= static_cast<double>(N);
    const double rms = std::sqrt(m2);
    out[0] = static_cast<float>(std::log10(rms + 1.0));
    out[1] = static_cast<float>(std::log10(peak + 1.0));
    out[2] = static_cast<float>(std::log10((peak + 1.0) / (rms + 1.0)));
    out[3] = static_cast<float>(std::log10(m4 / (m2 * m2 + 1e-12) + 1e-12));
    out[4] = static_cast<float>(static_cast<double>(zc) / static_cast<double>(N - 1));

    // ---- spectrum (Hann, zero-padded 2048-point FFT) -------------------------------------
    for (std::size_t i = 0; i < kNfft; ++i) {
        ws.re[i] = i < N ? static_cast<double>(ws.x[i] * hann(i)) : 0.0;
        ws.im[i] = 0.0;
    }
    if (!Fft::forward(ws.re, ws.im, kNfft)) return Status::InvalidArgument;
    double total = 0.0, fp = 0.0, logSum = 0.0;
    for (std::size_t k = 1; k <= kBins; ++k) {
        const double p = ws.re[k] * ws.re[k] + ws.im[k] * ws.im[k];
        ws.re[k] = p;  // reuse as power spectrum P[k]
        total += p;
        fp += (static_cast<double>(k) * kFs / kNfft) * p;
        logSum += std::log(p + 1e-12);
    }
    const double meanP = total / static_cast<double>(kBins);
    total += 1e-12;
    const double cHz = fp / total;
    double var = 0.0, cum = 0.0;
    std::size_t kStar = kBins;
    double bands[6] = {0, 0, 0, 0, 0, 0};
    for (std::size_t k = 1; k <= kBins; ++k) {
        const double f = static_cast<double>(k) * kFs / kNfft;
        const double p = ws.re[k];
        var += (f - cHz) * (f - cHz) * p;
        cum += p;
        if (kStar == kBins && cum >= 0.85 * total) kStar = k;
        for (int b = 0; b < 6; ++b) {
            const bool last = b == 5;
            if (f >= kEdges[b] && (last ? f <= kEdges[b + 1] : f < kEdges[b + 1])) bands[b] += p;
        }
    }
    out[5] = static_cast<float>(cHz / kNyq);
    out[6] = static_cast<float>(std::sqrt(var / total) / kNyq);
    out[7] = static_cast<float>((static_cast<double>(std::min(kStar, kBins)) * kFs / kNfft) / kNyq);
    out[8] = static_cast<float>(std::exp(logSum / static_cast<double>(kBins)) / (meanP + 1e-12));
    for (int b = 0; b < 6; ++b) out[9 + b] = static_cast<float>(bands[b] / total);

    // ---- envelope (causal 50 ms moving average, decimated to 100 Hz) ---------------------
    ws.cum[0] = 0.0;
    for (std::size_t i = 0; i < N; ++i) ws.cum[i + 1] = ws.cum[i] + std::fabs(static_cast<double>(ws.x[i]));
    for (int m = 0; m < kM; ++m) {
        const int idx = m * kDecim + (kDecim - 1);
        const int lo = std::max(0, idx - kEnvWin + 1);
        ws.env[m] = static_cast<float>((ws.cum[idx + 1] - ws.cum[lo]) / kEnvWin);
    }

    // ---- rhythm: envelope autocorrelation -------------------------------------------------
    double dMean = 0.0;
    for (int m = 0; m < kM; ++m) dMean += static_cast<double>(ws.env[m]);
    dMean /= kM;
    double ac0 = 1e-12;
    for (int m = 0; m < kM; ++m) {
        const double v = static_cast<double>(ws.env[m]) - dMean;
        ac0 += v * v;
    }
    int bestK = kLagMin;
    double bestV = -1e300;
    for (int k = kLagMin; k <= kLagMax; ++k) {
        double v = 0.0;
        for (int m = 0; m + k < kM; ++m) v += (static_cast<double>(ws.env[m]) - dMean) * (static_cast<double>(ws.env[m + k]) - dMean);
        if (v > bestV) {
            bestV = v;
            bestK = k;
        }
    }
    out[15] = static_cast<float>(100.0 / bestK);
    out[16] = static_cast<float>(bestV / ac0);

    // ---- STA/LTA on energy ------------------------------------------------------------------
    ws.cum[0] = 0.0;
    for (std::size_t i = 0; i < N; ++i) {
        const double v = ws.x[i];
        ws.cum[i + 1] = ws.cum[i] + v * v;
    }
    double best = 0.0;
    for (int i = kLta - 1; i < static_cast<int>(N); ++i) {
        const double sta = (ws.cum[i + 1] - ws.cum[i + 1 - kSta]) / kSta;
        const double lta = (ws.cum[i + 1] - ws.cum[i + 1 - kLta]) / kLta;
        best = std::max(best, sta / (lta + 1e-12));
    }
    out[17] = static_cast<float>(std::log10(best + 1e-12));

    // ---- impulses: peaks above median + 4·MAD, min separation 150 ms ----------------------
    const float med = median(ws.env, kM, ws.sorted);
    for (int m = 0; m < kM; ++m) ws.dev[m] = std::fabs(ws.env[m] - med);
    const float mad = median(ws.dev, kM, ws.sorted);
    const float thr = static_cast<float>(static_cast<double>(med) + 4.0 * static_cast<double>(mad) + 1e-6);
    int count = 0;
    for (int m = 1; m < kM - 1; ++m) {
        const float d = ws.env[m];
        if (d > thr && d > ws.env[m - 1] && d >= ws.env[m + 1]) {
            if (count > 0 && m - ws.peaks[count - 1] < kMinSep) {
                if (d > ws.env[ws.peaks[count - 1]]) ws.peaks[count - 1] = m;
            } else {
                ws.peaks[count++] = m;
            }
        }
    }
    out[18] = static_cast<float>(count / (static_cast<double>(N) / kFs));
    double cv = 0.0;
    if (count >= 3) {
        double gMean = 0.0;
        for (int i = 1; i < count; ++i) gMean += ws.peaks[i] - ws.peaks[i - 1];
        gMean /= (count - 1);
        double gVar = 0.0;
        for (int i = 1; i < count; ++i) {
            const double g = (ws.peaks[i] - ws.peaks[i - 1]) - gMean;
            gVar += g * g;
        }
        cv = std::sqrt(gVar / (count - 1)) / gMean;  // population std over the gaps
    }
    out[19] = static_cast<float>(cv);
    const float lim = static_cast<float>(2.0 * static_cast<double>(med));
    int active = 0;
    for (int m = 0; m < kM; ++m) active += ws.env[m] > lim ? 1 : 0;
    out[20] = static_cast<float>(static_cast<double>(active) / kM);
    return Status::Ok;
}

}  // namespace sentinel
