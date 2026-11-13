#include <iostream>
#include <string>
using namespace std;

enum Color { RED, GREEN = 5, BLUE };
struct Point { int x; int y; };
class Box {
    static int made;
    int w, h;
public:
    Box(int w = 1, int h = 1);
    ~Box() { cout << "bye " << w << endl; }
    int area() const;
    static int count() { return made; }
};
int Box::made = 0;
Box::Box(int w, int h) : w(w), h(h) { made++; }
int Box::area() const { return w * h; }

int add(int a, int b = 10) { return a + b; }
double add(double a, double b) { return a + b; }
void inc(int& r) { r++; }
Point mid(Point a, Point b) { Point m = {(a.x+b.x)/2, (a.y+b.y)/2}; return m; }
int fib(int n) { return n < 2 ? n : fib(n-1) + fib(n-2); }
void pushFront(struct N** head, int v);
struct N { int v; N* next; };
void pushFront(N** head, int v) { N* n = new N{v, *head}; *head = n; }

int main() {
    Color c = BLUE;
    cout << c << " " << GREEN << endl;
    Box b1(3, 4);
    { Box tmp; }
    cout << b1.area() << " " << Box::count() << endl;
    cout << add(1) << " " << add(1.5, 2.25) << endl;
    int k = 5; inc(k); int& rk = k; rk *= 2;
    cout << k << endl;
    Point p1 = {0, 0}, p2{4, 6};
    Point m = mid(p1, p2);
    Point* pp = &m; pp->x += 100;
    cout << m.x << "," << m.y << endl;
    int grid[2][3] = {{1,2,3},{4,5,6}};
    int s = 0;
    for (int i = 0; i < 2; i++) for (int j = 0; j < 3; j++) s += grid[i][j];
    cout << "sum " << s << " fib " << fib(6) << endl;
    string name = "hello";
    name[0] = 'H';
    cout << name << " " << name.length() << " " << name.substr(1, 3) << " " << name.find("lo") << endl;
    char word[10] = "abc";
    cout << word[1] << endl;
    N* head = nullptr;
    pushFront(&head, 1); pushFront(&head, 2);
    cout << head->v << head->next->v << endl;
    Point arr[3];
    arr[1].x = 7;
    Point* q = arr;
    q++;
    cout << q->x << endl;
    int x = 3;
    switch (x) { case 1: cout << "one"; case 3: cout << "three"; case 4: cout << "four"; break; default: cout << "def"; }
    cout << endl;
    double avg = 10 / 4;
    double avg2 = 10 / 4.0;
    cout << avg << " " << avg2 << " " << 7 % 3 << " " << -7 / 2 << endl;
    bool f = true;
    cout << f << " " << (x > 2 && x < 5) << endl;
    unsigned int u = 0; u--; cout << u << endl;
    int* dyn = new int[3]{1, 2, 3};
    cout << dyn[2] << endl;
    delete[] dyn;
    return 0;
}
