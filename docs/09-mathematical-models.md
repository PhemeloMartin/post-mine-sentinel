# 9. Mathematical models

Every formula below is implemented and tested. The file reference shows where.

## 9.1 Site risk: Residual Attraction Index (`ml/sentinel_ml/risk/rai.py`)

$$
z = \beta_0 + \beta_C C + \beta_V V + \beta_A A + \beta_P P + \beta_H H, \qquad \mathrm{RAI} = 100\,\sigma(z),\quad \sigma(z)=\frac{1}{1+e^{-z}}
$$

| Factor | Definition |
|---|---|
| Commodity attraction $C$ | Look-up (gold 1.0, diamonds 0.85, chrome 0.45, coal 0.40, PGM 0.35 … asbestos 0.02) |
| Residual value $V = C\cdot\hat R$ | $\hat R = \log_{10}(1+\bar R)/\max_{\text{commodity}}\log_{10}(1+\bar R)$, with residual $R = P\cdot\kappa(\text{commodity},\text{method})$ (e.g. narrow-reef gold κ ∈ [0.08, 0.15]; bord-and-pillar coal κ ∈ [0.30, 0.50]) |
| Accessibility $A$ | $A = s_{\text{status}}\, s_{\text{flood}}\, s_{\text{sealed}}\,\frac{1}{1+(d/3500)^2}\,\big(0.5+0.5(1-e^{-y/8})\big)$, where $d$ = depth (m) and $y$ = years since closure |
| Pressure $P$ | Min–max normalised $\log(1+G)$ of the population gravity $G=\sum_j \frac{\text{pop}_j}{1+(d_{ij}/10\,\text{km})^2}$ |
| History $H$ | $e^{-\Delta t/6}$ since the last reported incident ($\Delta t$ in years) |

Expert weights $\beta = (-6, 2, 2, 3, 1.5, 1.8)$. Calibration against weak labels: expert AUC 0.80 vs learned leave-one-out AUC 0.76 (`ml/artifacts/risk_calibration.json`).

## 9.2 Seismic propagation (`ml/sentinel_ml/signals/synth.py`, `sim/engine.ts`)

Surface (Rayleigh) waves in soil and body waves through rock:

$$
A_{\text{surf}}(r) = A_0\, r^{-1/2} e^{-\alpha r},\qquad A_{\text{body}}(r) = A_0\, r^{-1} e^{-\alpha r},\qquad \alpha=\frac{\pi f_0}{Q\,v}
$$

With soil Q ≈ 12–35 and $v_R$ ≈ 200–450 m/s; rock Q ≈ 60 and $v_P$ ≈ 2.5 km/s. Impacts are damped sinusoids $h(t)=e^{-t/\tau}\sin(2\pi f_0 t)$ arriving at $t_0 + r/v$. Walking cadence is 1.6–2.4 steps/s with ≈ 4 % jitter.

## 9.3 Edge signal processing (`ml/sentinel_ml/features/seismic.py` ≡ `firmware/.../features.cpp`)

* STA/LTA trigger: $R(n)=\dfrac{\frac{1}{N_s}\sum_{k=n-N_s+1}^{n}x_k^2}{\frac{1}{N_l}\sum_{k=n-N_l+1}^{n}x_k^2}$, with $N_s$ = 0.1 s and $N_l$ = 1 s (features); the streaming EWMA version runs on the node.
* Kurtosis $\kappa=\mathbb{E}[x^4]/\mathbb{E}[x^2]^2$ (≈ 3 for Gaussian noise; large for impacts).
* Spectral centroid $c=\sum f_kP_k/\sum P_k$; bandwidth $\sqrt{\sum(f_k-c)^2P_k/\sum P_k}$; 85 % roll-off; flatness (Wiener entropy) $\exp(\overline{\ln P})/\overline{P}$; band-energy ratios over [1, 8, 16, 32, 64, 128, 250] Hz using a 2048-point FFT with a Hann window $w_n = 0.5-0.5\cos\frac{2\pi n}{N-1}$.
* Gait rhythm: envelope autocorrelation $\rho(k)=\sum_m (d_m-\bar d)(d_{m+k}-\bar d)$ over lags of 0.5–5.9 Hz; cadence $=100/\arg\max_k \rho(k)$.
* Impulses: local maxima above $\mathrm{med}+4\,\mathrm{MAD}$ with 150 ms minimum separation; the coefficient of variation of their spacing separates rhythmic gait from irregular digging.

## 9.4 Edge classifier (`ml/sentinel_ml/edge`, `classifier.cpp`)

$$
\mathbf{z}=\frac{\mathbf{x}-\boldsymbol\mu}{\boldsymbol s},\quad \mathbf{h}_1=\mathrm{ReLU}(W_1^\top\mathbf z+\mathbf b_1),\quad \mathbf h_2=\mathrm{ReLU}(W_2^\top\mathbf h_1+\mathbf b_2),\quad p_k=\frac{e^{\ell_k-\max\ell}}{\sum_j e^{\ell_j-\max\ell}}
$$

$P(\text{threat})=\sum_{k\in\{\text{footsteps, digging, machinery, blast}\}}p_k$. The alarm threshold θ is chosen by a Neyman–Pearson rule on validation data: the smallest θ with benign false-alarm rate ≤ 2 %. Calibration is reported as expected calibration error, $\mathrm{ECE}=\sum_b \frac{|B_b|}{n}\,|\mathrm{acc}(B_b)-\mathrm{conf}(B_b)|$.

## 9.5 Evidence fusion (`ml/sentinel_ml/fusion/bayes.py`, `services/api/app/services/fusion.py`, `sim/engine.ts`)

Per site, the log-odds belief decays to the prior and absorbs each window's fused vote:

$$
L_t = L_0 + 2^{-\Delta t/T_{1/2}}\,(L_{t-1}-L_0) + \Lambda_w,\qquad P(\text{intrusion})=\sigma(L_t),\qquad L_0=\mathrm{logit}(\pi_{\text{site}})
$$

The prior comes from RAI: $\pi = \min(0.35,\max(0.02,\;0.02+0.33(\mathrm{RAI}/100)^2))$, and $T_{1/2}$ = 120 s.

**Chair–Varshney window vote** with a correlation discount (nodes hearing one source are not independent):

$$
\Lambda_w=\frac{1}{\sqrt{n_s}}\Big(\sum_{\text{threat}} c_i\ln\frac{P_D}{P_F}+\sum_{\text{benign}}\ln\frac{1-P_D}{1-P_F}\Big)+\frac{1}{\sqrt{n_p}}\sum_{\text{PIR}} \gamma_j \ln\frac{P_D^{\text{pir}}}{P_F^{\text{pir}}}
$$

Here $c_i = 0.4+0.6\frac{p_i-\theta}{1-\theta}$, $\gamma_j$ = 1 if the same node also voted threat, else 0.25, and negative evidence is floored at $L_0 - 2.5$ (absence of evidence). An alert requires $P\ge0.9$ on **two consecutive windows** (k-of-k persistence); a signed tamper frame bypasses this.

## 9.6 Localisation by TDOA (`ml/sentinel_ml/fusion/tdoa.py`, `sim/tdoa.ts`)

Unknowns $\theta=(x,y,t_0)$; residuals $r_i = t_i - t_0 - \lVert\mathbf p-\mathbf s_i\rVert/v$. The Levenberg–Marquardt step is

$$
\Delta\theta = -(J^\top J+\mu\,\mathrm{diag}(J^\top J))^{-1}J^\top \mathbf r,\qquad J_i = \Big[-\frac{x-x_i}{v d_i},\;-\frac{y-y_i}{v d_i},\;-1\Big]
$$

with covariance $\Sigma=\sigma_t^2(J^\top J)^{-1}$. Its eigen-decomposition gives the 1-σ error ellipse, and $\mathrm{GDOP}=\sqrt{\mathrm{tr}\,\Sigma_{xy}}$ explains why nodes *surround* the collar.

## 9.7 Radio (`ml/sentinel_ml/netsim/lora.py`, `sim/lora.ts`, `silknet/link.hpp`)

$$
T_{\text{sym}}=\frac{2^{SF}}{BW},\quad n_{\text{pay}}=8+\max\!\Big(\Big\lceil\frac{8PL-4SF+28+16\,\mathrm{CRC}-20\,IH}{4(SF-2DE)}\Big\rceil(CR+4),0\Big),\quad T_{\text{air}}=(n_{\text{pre}}+4.25+n_{\text{pay}})T_{\text{sym}}
$$

$$
S=-174+10\log_{10}BW+NF+\mathrm{SNR}_{\min}(SF),\qquad PL(d)=FSPL(1\,\text{m})+10n\log_{10}d+X_\sigma,\qquad M=P_{tx}+G_{tx}+G_{rx}-PL-S
$$

Packet reception probability $\mathrm{PRR}=\Phi\!\big((P_{rx}-S-4)/3\big)$. Routing minimises $\mathrm{ETX}=\sum 1/\mathrm{PRR}$ (Bellman–Ford). The duty cycle is $\sum T_{\text{air}}\le 0.01\times3600$ s per rolling hour. The SilkNet detection frame (32 B at SF9) takes **≈ 247 ms**.

## 9.8 Satellite change detection (`ml/sentinel_ml/satellite`)

$$
\mathrm{NDVI}=\frac{NIR-R}{NIR+R},\quad \mathrm{BSI}=\frac{(SWIR_1+R)-(NIR+B)}{(SWIR_1+R)+(NIR+B)},\quad z_{y,m}=\frac{x_{y,m}-\mathrm{med}_{y'<y}(x_{y',m})}{1.4826\,\mathrm{MAD}+\epsilon}
$$

$$
D_t = 0.45(-z^{\text{NDVI}}_t)+0.4\,z^{\text{BSI}}_t+0.15\,z^{\text{NDBI}}_t,\qquad S_t=\max(0,S_{t-1}+D_t-k),\quad \text{alarm if } S_t>h\;(k=0.5,\,h=4)
$$

## 9.9 Inspection planning (`ml/sentinel_ml/planning`)

**Orienteering problem:** $\max\sum_i r_i y_i$ subject to $\sum_{(i,j)}t_{ij}x_{ij}+\sum_i s_i y_i\le B$ and a single depot tour. It is solved exactly by DP over subsets, $O(2^n n^2)$, for $n\le 15$, and by greedy-ratio insertion + 2-opt + iterated local search at scale.

**QUBO (quantum-ready selection):** integer-scaled costs $a_i=\lceil c_i/u\rceil$, slack bits $y_k$, and

$$
E(\mathbf z)=-\sum_i r_ix_i + P\Big(\sum_i a_ix_i+\sum_k 2^k y_k - \lfloor B/u\rfloor\Big)^2,\qquad P=\sum_i r_i+1
$$

Integer scaling guarantees that any violation costs more than every achievable gain. **QAOA:** $|\gamma,\beta\rangle=\prod_l e^{-i\beta_l H_M}e^{-i\gamma_l H_C}|+\rangle^{\otimes n}$, simulated as an exact statevector ($\le$ 16 qubits) and optimised with COBYLA. It is benchmarked against brute force and simulated annealing.

## 9.10 Integrity

* Hash chain $h_0=\mathrm{SHA256}(\text{"GENESIS"})$, $h_i=\mathrm{SHA256}(h_{i-1}\,\Vert\,\mathrm{canon}(e_i))$: altering entry $j$ invalidates every $h_{i\ge j}$.
* Anti-replay (RFC 4303): accept counter $c$ if $c>h$ (shift the window) or if $h-c<64$ and bit $(h-c)$ is unset.
* AES-CCM: $T=\mathrm{CBC\text{-}MAC}_K(B_0\Vert \mathrm{AAD}\Vert P)$, tag $=T\oplus E_K(A_0)$, $C=P\oplus E_K(A_1)\Vert E_K(A_2)\cdots$
