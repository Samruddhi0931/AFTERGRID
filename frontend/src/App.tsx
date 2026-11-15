// import { useState } from "react";

// import {
//   saveRequest,
//   getRequests,
// } from "./db/database";

// function App() {
//   const [result, setResult] = useState("");

//   async function testDatabase() {
//     try {
//       const request = {
//         messageId: crypto.randomUUID(),
//         type: "RESOURCE_REQUEST" as const,
//         householdId: "H-047-001",
//         level: 47,
//         resource: "water" as const,
//         quantity: 15,
//         urgency: "high" as const,
//         createdAt: new Date().toISOString(),
//       };

//       await saveRequest(request);

//       const savedRequests = await getRequests();

//       setResult(
//         JSON.stringify(savedRequests, null, 2)
//       );
//     } catch (error) {
//       setResult(
//         error instanceof Error
//           ? error.message
//           : "Unknown error"
//       );
//     }
//   }

//   return (
//     <main style={{ padding: "2rem" }}>
//       <h1>HAVEN — Offline Storage Test</h1>

//       <p>Level 47 Emergency Request System</p>

//       <button onClick={testDatabase}>
//         Save Test Request
//       </button>

//       <pre style={{ whiteSpace: "pre-wrap" }}>
//         {result}
//       </pre>
//     </main>
//   );
// }

// export default App;

import ResidentRequest from "./pages/ResidentRequest";

function App() {
  return <ResidentRequest />;
}

export default App;