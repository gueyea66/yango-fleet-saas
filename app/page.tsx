export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900">
          🚗 Yango Fleet Manager
        </h1>
        <p className="mt-4 text-xl text-gray-600">
          Next.js + Supabase initialization complete
        </p>
        <p className="mt-8 text-sm text-gray-500">
          Project compiles without errors ✓
        </p>
        <div className="mt-8 space-x-4">
          <a
            href="/driver"
            className="inline-block rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700"
          >
            Driver Interface
          </a>
          <a
            href="/admin"
            className="inline-block rounded-lg bg-gray-600 px-6 py-3 text-white font-medium hover:bg-gray-700"
          >
            Admin Dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
