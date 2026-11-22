import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getEffectiveRole } from "@/lib/auth/roles";

// Refreshes the Supabase auth session cookie on every request so a
// long-lived tab doesn't silently expire mid-session. Runs before any
// page/route handler.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail loudly with a message that says exactly what's missing, instead of
  // the cryptic "process.env.X!" stack trace this used to throw. Middleware
  // runs on the Edge Runtime, which only sees env vars that are (a) present
  // in .env.local for `next dev` / `next start`, or (b) configured in your
  // hosting provider's dashboard for a deployed environment — .env.local is
  // never uploaded to a deployment.
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "[middleware] Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
        "- Chạy local: kiểm tra file .env.local ở thư mục gốc dự án, xoá .next rồi chạy lại `npm run dev`.\n" +
        "- Đã deploy: thêm 2 biến này vào Environment Variables trên nền tảng deploy (Vercel/Netlify/...) rồi redeploy."
    );
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set(name, value);
          response = NextResponse.next({ request });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.delete(name);
          response = NextResponse.next({ request });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Keep a server-side route guard in addition to the page guard. API routes
  // still return JSON 401/403 from their own handlers rather than redirects.
  const isDashboardRoute = request.nextUrl.pathname.startsWith("/dashboard");
  const isAdminDemoRoute = request.nextUrl.pathname.startsWith("/admin-demo");

  if ((isDashboardRoute || isAdminDemoRoute) && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const redirectResponse = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (isAdminDemoRoute && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, access_role")
      .eq("id", user.id)
      .maybeSingle();

    if (getEffectiveRole(profile) !== "admin") {
      const dashboardUrl = request.nextUrl.clone();
      dashboardUrl.pathname = "/dashboard";
      dashboardUrl.search = "";
      const redirectResponse = NextResponse.redirect(dashboardUrl);
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
      return redirectResponse;
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:jpg|jpeg|png|svg|webp)).*)"],
};
