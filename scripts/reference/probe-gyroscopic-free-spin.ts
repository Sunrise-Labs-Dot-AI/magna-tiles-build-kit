import { it } from "vitest";
import { runFreeSpinProbe } from "./probe-free-spin";

it("records torque-free anisotropic and isotropic controls with the selected native gyro flag", runFreeSpinProbe, 120000);
