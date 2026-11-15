import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, saveRequest } from "../db/database";
import styles from "./ResidentRequest.module.css";

type Resource = "food" | "water" | "medicine";
type Urgency = "normal" | "high" | "critical";

const resourceUnits: Record<Resource, string> = {
  food: "packages",
  water: "liters",
  medicine: "kits",
};

export default function ResidentRequest() {
  const [householdId, setHouseholdId] = useState("");
  const [level, setLevel] = useState("47");
  const [resource, setResource] = useState<Resource>("water");
  const [quantity, setQuantity] = useState("1");
  const [urgency, setUrgency] = useState<Urgency>("normal");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);

  // Reactively reload requests whenever IndexedDB changes.
  const requests = useLiveQuery(
    () => db.requests.orderBy("createdAt").reverse().toArray(),
    []
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setFeedback("");

    try {
      const request = {
        messageId: crypto.randomUUID(),
        type: "RESOURCE_REQUEST" as const,
        householdId: householdId.trim(),
        level: Number(level),
        resource,
        quantity: Number(quantity),
        urgency,
        createdAt: new Date().toISOString(),
      };

      await saveRequest(request);

      setFeedback("Request saved successfully on this device.");
      setQuantity("1");
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Unable to save request."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>H</div>
          <div>
            <strong>HAVEN</strong>
            <span>Resident Emergency Portal</span>
          </div>
        </div>
        <span className={styles.status}>LOCAL STORAGE</span>
      </header>

      <div className={styles.content}>
        <section className={styles.intro}>
          <span className={styles.eyebrow}>
            THE HOLLOW / RESIDENT SERVICES
          </span>
          <h1>Request essential supplies</h1>
          <p>
            Submit a request for food, water, or medical
            supplies. Your request stays on this device
            until you share it.
          </p>
        </section>

        <div className={styles.layout}>
          <section className={styles.card}>
            <h2>New emergency request</h2>
            <p className={styles.subtitle}>
              All fields are required.
            </p>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.twoColumns}>
                <label>
                  Household ID
                  <input
                    value={householdId}
                    onChange={(e) => setHouseholdId(e.target.value)}
                    placeholder="H-047-001"
                    maxLength={64}
                    required
                  />
                </label>

                <label>
                  Residential level
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    required
                  />
                </label>
              </div>

              <label>
                Resource type
                <select
                  value={resource}
                  onChange={(e) =>
                    setResource(e.target.value as Resource)
                  }
                >
                  <option value="water">Water</option>
                  <option value="food">Food</option>
                  <option value="medicine">Medicine</option>
                </select>
              </label>

              <div className={styles.twoColumns}>
                <label>
                  Quantity ({resourceUnits[resource]})
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                  />
                </label>

                <label>
                  Urgency
                  <select
                    value={urgency}
                    onChange={(e) =>
                      setUrgency(e.target.value as Urgency)
                    }
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
              </div>

              <div className={styles.notice}>
                Requests are stored locally using IndexedDB.
                Sharing and encryption will be added next.
              </div>

              <button
                type="submit"
                disabled={saving}
                className={styles.submit}
              >
                {saving ? "Saving..." : "Save emergency request"}
              </button>

              {feedback && (
                <p role="status" className={styles.feedback}>
                  {feedback}
                </p>
              )}
            </form>
          </section>

          <section className={styles.card}>
            <div className={styles.queueHeader}>
              <div>
                <h2>Saved requests</h2>
                <p className={styles.subtitle}>
                  Emergency requests on this device
                </p>
              </div>
              <span className={styles.count}>
                {requests?.length ?? 0}
              </span>
            </div>

            {requests === undefined ? (
              <p>Loading requests...</p>
            ) : requests.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyIcon}>◎</span>
                <strong>No requests yet</strong>
                <p>
                  Your saved emergency requests will
                  appear here.
                </p>
              </div>
            ) : (
              <div className={styles.requestList}>
                {requests.map((item) => (
                  <article key={item.id} className={styles.request}>
                    <div className={styles.requestTop}>
                      <strong>
                        {item.request.resource.toUpperCase()}
                      </strong>
                      <span className={styles.pending}>
                        {item.status}
                      </span>
                    </div>

                    <p>
                      {item.request.quantity}{" "}
                      {resourceUnits[item.request.resource]}
                      {" · "}
                      Level {item.request.level}
                    </p>

                    <div className={styles.requestBottom}>
                      <span>{item.request.householdId}</span>
                      <span>
                        {item.request.urgency.toUpperCase()}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}