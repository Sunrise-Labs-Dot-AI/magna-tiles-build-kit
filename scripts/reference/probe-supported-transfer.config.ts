import {defineConfig} from "vitest/config";
import base from "../../vitest.config";
export default defineConfig({...base,test:{...base.test,include:["scripts/reference/probe-supported-transfer.ts"],maxWorkers:1,testTimeout:1800000}});
