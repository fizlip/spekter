import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center p-6 rounded-full">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Spekter</CardTitle>
          <CardDescription>Next.js + shadcn/ui is ready to go.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Edit <code className="font-mono">src/app/page.tsx</code> to get
            started. Add components with{" "}
            <code className="font-mono">npx shadcn@latest add</code>.
          </p>
        </CardContent>
        <CardFooter className="gap-2">
          <Button>Get started</Button>
          <Button variant="outline">Docs</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
