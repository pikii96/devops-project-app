// Mock pg before requiring app to prevent real DB connection
jest.mock("pg", () => {
    const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        end: jest.fn().mockResolvedValue(undefined)
    };
    return { Pool: jest.fn(() => mockPool) };
});

// Mock redis before requiring app to prevent real Redis connection
jest.mock("redis", () => {
    const mockClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
        isOpen: true,
        quit: jest.fn().mockResolvedValue(undefined),
        lPush: jest.fn().mockResolvedValue(1)
    };
    return { createClient: jest.fn(() => mockClient) };
});

// Mock uuid (pure ESM in v14) to avoid Jest CommonJS parsing issue
jest.mock("uuid", () => ({
    v4: jest.fn(() => "test-uuid-12345-mock")
}));

const request = require("supertest");
const app = require("../src/server");

describe("Ticketing API", () => {
    describe("GET /healthz", () => {
        it("returns 200 with status ok", async () => {
            const res = await request(app).get("/healthz");

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: "ok", service: "api" });
        });
    });

    describe("GET /events", () => {
        it("returns 200 with array of 3 events", async () => {
            const res = await request(app).get("/events");

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body).toHaveLength(3);
        });

        it("each event has required fields", async () => {
            const res = await request(app).get("/events");

            res.body.forEach((event) => {
                expect(event).toHaveProperty("id");
                expect(event).toHaveProperty("name");
                expect(event).toHaveProperty("location");
                expect(event).toHaveProperty("availableTickets");
            });
        });
    });

    describe("POST /tickets/purchase", () => {
        it("returns 202 with orderId for valid async request", async () => {
            const res = await request(app)
                .post("/tickets/purchase")
                .send({
                    eventId: "evt-1001",
                    customerEmail: "test@example.com",
                    quantity: 2
                });

            expect(res.status).toBe(202);
            expect(res.body).toHaveProperty("orderId");
            expect(res.body).toHaveProperty("message");
        });

        it("returns 400 when eventId is missing", async () => {
            const res = await request(app)
                .post("/tickets/purchase")
                .send({
                    customerEmail: "test@example.com",
                    quantity: 1
                });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty("error");
        });

        it("returns 400 when customerEmail is missing", async () => {
            const res = await request(app)
                .post("/tickets/purchase")
                .send({
                    eventId: "evt-1001",
                    quantity: 1
                });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty("error");
        });

        it("returns 404 when eventId does not exist", async () => {
            const res = await request(app)
                .post("/tickets/purchase")
                .send({
                    eventId: "evt-9999",
                    customerEmail: "test@example.com",
                    quantity: 1
                });

            expect(res.status).toBe(404);
            expect(res.body).toHaveProperty("error");
        });

        it("returns 400 when quantity is zero or negative", async () => {
            const res = await request(app)
                .post("/tickets/purchase")
                .send({
                    eventId: "evt-1001",
                    customerEmail: "test@example.com",
                    quantity: 0
                });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty("error");
        });
    });
});
