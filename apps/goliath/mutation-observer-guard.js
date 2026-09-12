// Prevent MutationObserver callbacks from recursively retriggering themselves
// when they synchronously rewrite the same observed DOM subtree.
// This preserves normal observation while suppressing self-generated mutation loops.
(function installGoliathMutationObserverGuard(){
  const NativeMutationObserver = window.MutationObserver;
  if (!NativeMutationObserver || window.__goliathMutationObserverGuardInstalled) return;

  class GuardedMutationObserver {
    constructor(callback){
      this.callback = callback;
      this.targets = [];
      this.native = new NativeMutationObserver((records) => {
        const targets = this.targets.slice();
        this.native.disconnect();
        try {
          this.callback(records, this);
        } finally {
          for (const [target, options] of targets) this.native.observe(target, options);
        }
      });
    }

    observe(target, options){
      this.targets = this.targets.filter(([existing]) => existing !== target);
      this.targets.push([target, options]);
      this.native.observe(target, options);
    }

    disconnect(){
      this.targets = [];
      this.native.disconnect();
    }

    takeRecords(){
      return this.native.takeRecords();
    }
  }

  window.MutationObserver = GuardedMutationObserver;
  window.__goliathMutationObserverGuardInstalled = true;
})();
