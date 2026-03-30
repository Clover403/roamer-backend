import type { Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { clearAuthCookie, setAuthCookie, signAuthToken, verifyAuthToken } from "../lib/auth";
import { env } from "../config/env";
import { sanitizePlainText } from "../lib/security";

const toAuthUser = <T extends {
  id: string;
  email: string;
  fullName: string;
  role: "USER" | "ADMIN";
  isEmailVerified: boolean;
  verificationStatus: "UNVERIFIED" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
}>(user: T, rejectionReason?: string | null) => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  role: user.role,
  isEmailVerified: user.isEmailVerified,
  verificationStatus: user.role === "ADMIN" ? "APPROVED" : user.verificationStatus,
  verificationRejectionReason: rejectionReason ?? null,
});

const registerSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  password: z.string().min(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(6),
});

const googleTokenInfoSchema = z.object({
  aud: z.string(),
  email: z.string().email(),
  email_verified: z.string(),
  name: z.string().optional(),
});

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const hashScopedToken = (scope: "password_reset", token: string) => hashToken(`${scope}:${token}`);

const getEmailVerificationLink = (token: string) => {
  const url = new URL("/email-verification", env.APP_BASE_URL);
  url.searchParams.set("token", token);
  return url.toString();
};

const getPasswordResetLink = (token: string) => {
  const url = new URL("/reset-password", env.APP_BASE_URL);
  url.searchParams.set("token", token);
  return url.toString();
};

const createEmailVerificationToken = async (userId: string) => {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    },
  });

  return token;
};

const createPasswordResetToken = async (userId: string) => {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashScopedToken("password_reset", token);

  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  });

  return token;
};

const sendEmailVerificationEmail = async (params: { email: string; fullName: string; token: string }) => {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return false;
  }

  const verificationLink = getEmailVerificationLink(params.token);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [params.email],
        subject: "Verify your Roamer account",
        html: `
          <div style="font-family: Inter, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
            <h2 style="margin:0 0 16px;">Welcome to Roamer</h2>
            <p style="margin:0 0 12px;">Hi ${params.fullName || "there"},</p>
            <p style="margin:0 0 16px;">Please verify your email to activate manual login.</p>
            <p style="margin:0 0 20px;">
              <a href="${verificationLink}" style="background:#000;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;">Verify Email</a>
            </p>
            <p style="margin:0;color:#64748b;font-size:12px;">This link expires in 24 hours.</p>
          </div>
        `,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
};

const sendPasswordResetEmail = async (params: { email: string; fullName: string; token: string }) => {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return false;
  }

  const resetLink = getPasswordResetLink(params.token);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [params.email],
        subject: "Reset your Roamer password",
        html: `
          <div style="font-family: Inter, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
            <h2 style="margin:0 0 16px;">Password reset request</h2>
            <p style="margin:0 0 12px;">Hi ${params.fullName || "there"},</p>
            <p style="margin:0 0 16px;">We received a request to reset your password.</p>
            <p style="margin:0 0 20px;">
              <a href="${resetLink}" style="background:#000;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;">Reset Password</a>
            </p>
            <p style="margin:0;color:#64748b;font-size:12px;">This link expires in 1 hour.</p>
          </div>
        `,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
};

const redirectWithError = (res: Response, errorCode: string) => {
  const target = new URL("/auth", env.APP_BASE_URL);
  target.searchParams.set("error", errorCode);
  res.redirect(target.toString());
};

const redirectGoogleSuccess = (res: Response) => {
  const target = new URL("/home", env.APP_BASE_URL);
  res.redirect(target.toString());
};

export const register = async (req: Request, res: Response) => {
  const rawPayload = registerSchema.parse(req.body);
  const payload = {
    ...rawPayload,
    email: rawPayload.email.trim().toLowerCase(),
    fullName: sanitizePlainText(rawPayload.fullName, 120),
    phone: rawPayload.phone ? sanitizePlainText(rawPayload.phone, 40) : undefined,
  };

  const existing = await prisma.user.findUnique({ where: { email: payload.email } });

  if (existing) {
    if (!existing.isEmailVerified && !env.DEV_SKIP_EMAIL_VERIFICATION) {
      try {
        const verificationToken = await createEmailVerificationToken(existing.id);
        const emailed = await sendEmailVerificationEmail({
          email: existing.email,
          fullName: existing.fullName,
          token: verificationToken,
        });

        res.status(200).json({
          message: emailed
            ? "Email is already registered but not verified. We sent a new verification email."
            : "Email is already registered but not verified. Email sending is unavailable, so use the verification link shown in the app.",
          emailVerificationRequired: true,
          verificationToken,
          verificationLink: getEmailVerificationLink(verificationToken),
        });
        return;
      } catch {
        res.status(500).json({
          message: "Unable to prepare verification for this email right now. Please try again.",
        });
        return;
      }
    }

    res.status(409).json({ message: "Email is already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(payload.password, 12);

  const user = await prisma.user.create({
    data: {
      email: payload.email,
      fullName: payload.fullName,
      phone: payload.phone,
      passwordHash,
      isEmailVerified: env.DEV_SKIP_EMAIL_VERIFICATION ? true : false,
    },
  });

  if (!env.DEV_SKIP_EMAIL_VERIFICATION) {
    try {
      const verificationToken = await createEmailVerificationToken(user.id);
      const emailed = await sendEmailVerificationEmail({
        email: user.email,
        fullName: user.fullName,
        token: verificationToken,
      });

      res.status(201).json({
        message: emailed
          ? "Registration successful. Please verify your email before logging in."
          : "Registration successful. Email sending is unavailable, so open the verification link from the app to continue.",
        emailVerificationRequired: true,
        verificationToken,
        verificationLink: getEmailVerificationLink(verificationToken),
        user: toAuthUser(user),
      });
      return;
    } catch {
      res.status(500).json({
        message: "Registration failed because verification token could not be created. Please try again.",
      });
      return;
    }
  }

  const token = signAuthToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  if (env.DEV_SKIP_EMAIL_VERIFICATION) {
    setAuthCookie(res, token);
  }

  res.status(201).json({
    message: env.DEV_SKIP_EMAIL_VERIFICATION
      ? "Registration successful (dev bypass). Email verification is disabled in development."
      : "Registration successful. Please verify your email before logging in.",
    emailVerificationRequired: !env.DEV_SKIP_EMAIL_VERIFICATION,
    user: toAuthUser(user),
  });
};

export const login = async (req: Request, res: Response) => {
  const rawPayload = loginSchema.parse(req.body);
  const payload = {
    ...rawPayload,
    email: rawPayload.email.trim().toLowerCase(),
  };

  const user = await prisma.user.findUnique({ where: { email: payload.email } });

  if (!user || !user.passwordHash) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const isValid = await bcrypt.compare(payload.password, user.passwordHash);

  if (!isValid) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  if (user.role !== "ADMIN" && !user.isEmailVerified && !env.DEV_SKIP_EMAIL_VERIFICATION) {
    res.status(403).json({
      message: "Please verify your email before logging in",
      emailVerificationRequired: true,
    });
    return;
  }

  const token = signAuthToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  setAuthCookie(res, token);

  res.status(200).json({
    message: "Login successful",
    user: toAuthUser(user),
  });
};

export const me = async (req: Request, res: Response) => {
  const token = req.cookies?.[env.JWT_COOKIE_NAME] as string | undefined;

  if (!token) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  let payload: { sub: string };
  try {
    payload = verifyAuthToken(token);
  } catch {
    clearAuthCookie(res);
    res.status(401).json({ message: "Invalid or expired session" });
    return;
  }

  const userId = payload.sub;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      identityProfile: true,
      verificationSubmissions: {
        orderBy: {
          submittedAt: "desc",
        },
        take: 1,
        select: {
          status: true,
          reviewerNotes: true,
        },
      },
    },
  });

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const rejectionReason =
    user.verificationStatus === "REJECTED"
      ? user.verificationSubmissions[0]?.reviewerNotes ?? null
      : null;

  res.status(200).json({ user: toAuthUser(user, rejectionReason) });
};

export const logout = async (_req: Request, res: Response) => {
  const token = _req.cookies?.[env.JWT_COOKIE_NAME] as string | undefined;

  if (token) {
    try {
      const payload = verifyAuthToken(token);
      await prisma.analyticsEvent.create({
        data: {
          eventType: "CHAT_MESSAGE",
          actorUserId: payload.sub,
          metadata: {
            activityType: "USER_LOGOUT",
          },
        },
      });
    } catch {
      // ignore invalid/expired session during logout
    }
  }

  clearAuthCookie(res);
  res.status(200).json({ message: "Logged out" });
};

export const resendEmailVerification = async (req: Request, res: Response) => {
  const rawPayload = resendVerificationSchema.parse(req.body);
  const payload = { email: rawPayload.email.trim().toLowerCase() };

  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: {
      id: true,
      email: true,
      fullName: true,
      isEmailVerified: true,
    },
  });

  if (!user) {
    res.status(200).json({ message: "If the email exists, a verification email has been sent." });
    return;
  }

  if (user.isEmailVerified) {
    res.status(200).json({ message: "Email is already verified." });
    return;
  }

  const verificationToken = await createEmailVerificationToken(user.id);
  const emailed = await sendEmailVerificationEmail({
    email: user.email,
    fullName: user.fullName,
    token: verificationToken,
  });

  res.status(200).json({
    message: emailed
      ? "Verification email sent."
      : "Email sending is unavailable right now, so use the verification link from the app.",
    verificationToken,
    verificationLink: getEmailVerificationLink(verificationToken),
  });
};

export const verifyEmail = async (req: Request, res: Response) => {
  const token = String(req.query.token ?? "").trim();

  if (!token) {
    res.status(400).json({ message: "Verification token is required" });
    return;
  }

  const tokenHash = hashToken(token);

  const tokenRecord = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: {
      user: true,
    },
  });

  if (!tokenRecord) {
    res.status(400).json({ message: "Invalid or expired verification token" });
    return;
  }

  if (tokenRecord.usedAt) {
    if (tokenRecord.user.isEmailVerified) {
      res.status(200).json({
        message: "Email already verified. Please sign in to continue.",
        email: tokenRecord.user.email,
      });
      return;
    }

    res.status(400).json({ message: "Invalid or expired verification token" });
    return;
  }

  if (tokenRecord.expiresAt < new Date()) {
    if (tokenRecord.user.isEmailVerified) {
      res.status(200).json({
        message: "Email already verified. Please sign in to continue.",
        email: tokenRecord.user.email,
      });
      return;
    }

    res.status(400).json({ message: "Invalid or expired verification token" });
    return;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: tokenRecord.userId },
      data: { isEmailVerified: true },
    }),
    prisma.emailVerificationToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    }),
    prisma.emailVerificationToken.deleteMany({
      where: {
        userId: tokenRecord.userId,
        id: { not: tokenRecord.id },
      },
    }),
  ]);

  res.status(200).json({
    message: "Email verified successfully. Please sign in to continue.",
    email: tokenRecord.user.email,
  });
};

export const forgotPassword = async (req: Request, res: Response) => {
  const rawPayload = forgotPasswordSchema.parse(req.body);
  const payload = { email: rawPayload.email.trim().toLowerCase() };

  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: {
      id: true,
      email: true,
      fullName: true,
    },
  });

  if (!user) {
    res.status(200).json({ message: "If the email exists, a reset link has been sent." });
    return;
  }

  const resetToken = await createPasswordResetToken(user.id);
  const emailed = await sendPasswordResetEmail({
    email: user.email,
    fullName: user.fullName,
    token: resetToken,
  });

  res.status(200).json({
    message: emailed
      ? "If the email exists, a reset link has been sent."
      : "Email sending is unavailable right now, so use the reset link from the app.",
    resetToken,
    resetLink: getPasswordResetLink(resetToken),
  });
};

export const resetPassword = async (req: Request, res: Response) => {
  const payload = resetPasswordSchema.parse(req.body);
  const tokenHash = hashScopedToken("password_reset", payload.token.trim());

  const tokenRecord = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!tokenRecord || tokenRecord.usedAt || tokenRecord.expiresAt < new Date()) {
    res.status(400).json({ message: "Invalid or expired reset token" });
    return;
  }

  const passwordHash = await bcrypt.hash(payload.password, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: tokenRecord.userId },
      data: { passwordHash },
    }),
    prisma.emailVerificationToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    }),
  ]);

  res.status(200).json({ message: "Password reset successful" });
};

export const googleAuthStart = async (_req: Request, res: Response) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) {
    redirectWithError(res, "google_not_configured");
    return;
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("prompt", "select_account");

  res.redirect(authUrl.toString());
};

export const googleAuthCallback = async (req: Request, res: Response) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    redirectWithError(res, "google_not_configured");
    return;
  }

  const code = String(req.query.code ?? "").trim();
  if (!code) {
    redirectWithError(res, "google_auth_failed");
    return;
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      redirectWithError(res, "google_auth_failed");
      return;
    }

    const tokenData = (await tokenResponse.json()) as { id_token?: string };
    if (!tokenData.id_token) {
      redirectWithError(res, "google_auth_failed");
      return;
    }

    const tokenInfoResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenData.id_token)}`
    );

    if (!tokenInfoResponse.ok) {
      redirectWithError(res, "google_auth_failed");
      return;
    }

    const rawTokenInfo = await tokenInfoResponse.json();
    const tokenInfo = googleTokenInfoSchema.parse(rawTokenInfo);

    if (tokenInfo.aud !== env.GOOGLE_CLIENT_ID || tokenInfo.email_verified !== "true") {
      redirectWithError(res, "google_auth_failed");
      return;
    }

    const normalizedEmail = tokenInfo.email.trim().toLowerCase();
    const fallbackName = normalizedEmail.split("@")[0] ?? "Google User";

    const user = await prisma.user.upsert({
      where: { email: normalizedEmail },
      update: {
        fullName: tokenInfo.name?.trim() || undefined,
        isEmailVerified: true,
      },
      create: {
        email: normalizedEmail,
        fullName: tokenInfo.name?.trim() || fallbackName,
        isEmailVerified: true,
      },
    });

    const token = signAuthToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    setAuthCookie(res, token);
    redirectGoogleSuccess(res);
  } catch {
    redirectWithError(res, "google_auth_failed");
  }
};
