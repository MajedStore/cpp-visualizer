#include <iostream>
using namespace std;
int* bad() { int local = 5; return &local; }
int main() {
    int* p = bad();
    cout << *p;
}
