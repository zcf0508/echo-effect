class A {
  int m() { return 1; }
}
class B {
  int x() { return new A().m(); }
}

