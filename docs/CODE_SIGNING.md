# Windows Authenticode Code Signing Guide

Product: **MantiCollect — A Mantitup Product**  
Architecture: Electron + Next.js App Router  
Packaging: Electron Builder + NSIS  

---

## 1. Overview & Security Policy

Windows Authenticode code signing ensures that executables distributed to end users:
1. Guarantee cryptographic integrity (tamper-proofing).
2. Verify publisher identity (Mantitup).
3. Prevent Windows SmartScreen warnings on download and installation.

### Security Non-Negotiables
* **Never commit certificates (`.pfx`, `.p12`), private keys, or passwords** to Git.
* **Never hardcode passwords or certificate paths** in `package.json` or source code.
* Development and local testing artifacts are **strictly unsigned**.
* Production release signatures are executed exclusively in secure CI environments using ephemeral secrets or approved hardware security modules (HSM / Azure Trusted Signing).

---

## 2. Supported Electron Builder Signing Mechanisms

`electron-builder` natively supports Windows Authenticode signing via standard environment variables:

| Environment Variable | Description | Security Best Practice |
| :--- | :--- | :--- |
| `CSC_LINK` | Base64-encoded `.pfx` certificate data OR path to certificate file | Store in GitHub Secret `CSC_LINK` |
| `CSC_KEY_PASSWORD` | Password protecting the `.pfx` private key | Store in GitHub Secret `CSC_KEY_PASSWORD` |
| `WIN_CSC_LINK` | Windows-specific override for `CSC_LINK` | Optional |
| `WIN_CSC_KEY_PASSWORD` | Windows-specific override for `CSC_KEY_PASSWORD` | Optional |

### Safe Fallback (Unsigned Local Builds)
When `CSC_LINK` and `CSC_KEY_PASSWORD` are unset:
- `electron-builder` produces a functional, **unsigned** NSIS installer (`release/MantiCollect-Setup-<version>.exe`).
- The build succeeds without warnings or simulated signatures.
- Windows will show an informational SmartScreen prompt stating "Unknown Publisher" during local testing.

---

## 3. How to Configure Signing for Production Releases

### Option A: Standard Commercial / EV PFX Certificate
1. Obtain an Authenticode Code Signing certificate from a Microsoft-trusted Certificate Authority (e.g. Sectigo, DigiCert, GlobalSign).
2. Export the certificate and private key as a password-protected `.pfx` file.
3. Convert the `.pfx` file to a Base64 string:
   ```powershell
   # PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("path\to\cert.pfx")) | Set-Clipboard
   ```
4. Navigate to your GitHub repository:
   - **Settings** → **Secrets and variables** → **Actions**
5. Add the following repository secrets:
   - `CSC_LINK`: Paste the base64 string.
   - `CSC_KEY_PASSWORD`: Enter the certificate password.
6. When a tag like `v0.1.0` is pushed, the GitHub Actions release workflow automatically passes these secrets to `electron-builder`.

### Option B: Cloud-Based Signing (Azure Trusted Signing / HSM)
For Extended Validation (EV) certificates requiring FIPS 140-2 Level 2 hardware tokens or cloud HSM:
- Configure Azure Trusted Signing via `@electron/windows-sign` or a custom signing script via `build.win.sign`.
- Provide Azure client credentials via GitHub Actions secrets (`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`).

---

## 4. Verifying Signature Locally or in CI

To inspect whether an installer or executable has a valid signature on Windows:

```powershell
# Inspect Authenticode signature using PowerShell
Get-AuthenticodeSignature .\release\MantiCollect-Setup-0.1.0.exe | Format-List
```

Expected outputs:
* **Signed Build**: `Status: Valid`, `SignerCertificate: Subject CN=Mantitup...`
* **Unsigned Build**: `Status: NotSigned`, `StatusMessage: The file is not digitally signed.`

---

## 5. Auto-Updater Signature Requirements

When configured with `electron-updater`:
- Windows NSIS auto-updates **require** that update artifacts are signed by the same publisher certificate as the installed version.
- `electron-updater` validates file integrity (SHA-512 hashes in `latest.yml`) and checks publisher certificates before applying updates.
- In unsigned development mode, `MantiCollect` safely reports `unsupported_dev` and disables auto-install to prevent arbitrary code execution.
