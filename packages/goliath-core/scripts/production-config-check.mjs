import { readProductionBindingConfiguration, assertProductionBindingConfiguration } from '../dist/src/production/bindings.js';
try {
  const config=readProductionBindingConfiguration(process.env);
  assertProductionBindingConfiguration(config);
  console.log(JSON.stringify({ready:true,configuration:{...config,databaseUrlPresent:Boolean(config.databaseUrlPresent)}}));
} catch (error) {
  console.error(JSON.stringify({ready:false,message:error instanceof Error?error.message:String(error)}));
  process.exitCode=1;
}
