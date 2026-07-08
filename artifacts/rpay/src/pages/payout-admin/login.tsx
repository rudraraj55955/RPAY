import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLogin, UserRole } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/auth-layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
type LoginFormValues = z.infer<typeof loginSchema>;

export default function PayoutAdminLogin() {
  const [_, setLocation] = useLocation();
  const { login: setAuthToken } = useAuth();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useLogin();

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          const role = res.user.role as string;
          if (role !== UserRole.payout_admin && role !== UserRole.payout_super_admin) {
            toast.error("Unauthorized. Payout Admin access required.");
            return;
          }
          setAuthToken(res.token);
          toast.success("Welcome back.");
          setLocation("/payout-admin/dashboard");
        },
        onError: (err) => {
          toast.error((err as any)?.message || "Login failed");
        },
      }
    );
  };

  return (
    <AuthLayout title="Payout Admin Portal" subtitle="Sign in to manage payout operations">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input placeholder="payoutadmin@rasokart.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? "Authenticating..." : "Sign in"}
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            <Link href="/" className="text-primary hover:underline">← Back to RasoKart</Link>
          </div>
        </form>
      </Form>
    </AuthLayout>
  );
}
