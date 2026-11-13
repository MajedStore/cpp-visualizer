#include <iostream>
#include <vector>
using namespace std;
struct Student { string name; int grade; };
int main() {
    vector<Student> v;
    v.push_back({"Ali", 90});
    v.push_back(Student{"Sara", 85});
    int n; 
    while (cin >> n) { v.push_back({"x", n}); }
    for (const Student& s : v) cout << s.name << ":" << s.grade << " ";
    cout << endl;
    vector<vector<int>> mat(2, vector<int>(3, 0));
    mat[1][2] = 9;
    cout << mat[1][2] << " " << mat.size() << endl;
    int* p;
    cout << *p << endl;
}
