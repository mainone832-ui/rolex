import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "sessionToken";

const LOGIN_ROUTE = "/login";
const DEFAULT_AUTHENTICATED_ROUTE = "/dashboard";

function isProtectedRoute(pathname: string) {
  const protectedRoutes = [
    "/",
    "/dashboard",
    "/devices",
    "/notifications",
    "/forms",
    "/favorites",
    "/crashes",
    "/admin-sessions",
    "/settings",
  ];

  return protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
  const protectedRoute = isProtectedRoute(pathname);
  const loginRoute = pathname === LOGIN_ROUTE;

  if (!protectedRoute && !loginRoute) {
    return NextResponse.next();
  }

  let hasValidSession = Boolean(sessionToken);

  const strictVerify =
    process.env.SESSION_STRICT_VERIFY?.toLowerCase() !== "false";

  if (sessionToken && strictVerify) {
    try {
      const verifyUrl = new URL("/api/verify-session", request.url);
      const res = await fetch(verifyUrl, {
        cache: "no-store",
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        },
      });
      hasValidSession = res.ok;
    } catch (error) {
      console.error("Failed to validate session in proxy", error);
      hasValidSession = false;
    }
  }

  if (loginRoute && hasValidSession) {
    return NextResponse.redirect(
      new URL(DEFAULT_AUTHENTICATED_ROUTE, request.url),
    );
  }

  if (sessionToken && !hasValidSession) {
    const response = protectedRoute
      ? NextResponse.redirect(new URL(LOGIN_ROUTE, request.url))
      : NextResponse.next();

    response.cookies.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 0,
      secure: process.env.NODE_ENV === "production",
    });

    return response;
  }

  if (protectedRoute && !hasValidSession) {
    return NextResponse.redirect(new URL(LOGIN_ROUTE, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/dashboard/:path*",
    "/devices/:path*",
    "/notifications/:path*",
    "/forms/:path*",
    "/favorites/:path*",
    "/crashes/:path*",
    "/admin-sessions/:path*",
    "/settings/:path*",
  ],
};
